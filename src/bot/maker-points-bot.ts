import Decimal from 'decimal.js';
import { EventEmitter } from 'eventemitter3';
import { StandXAuth } from '../api/standx-auth';
import { StandXClient } from '../api/standx-client';
import { StandXWebSocket } from '../api/standx-websocket';
import { BinanceClient } from '../api/binance-client';
import { OrderManager } from './order-manager';
import { telegram } from '../notify/telegram';
import { log } from '../utils/logger';
import { getConfig } from '../config';
import { BotState, BotStats, TradingMode, OrderSide, WSMarkPriceData, WSOrderData } from '../types';

/**
 * StandX Maker Points Bot
 * Main bot logic for farming maker points
 */
export class MakerPointsBot extends EventEmitter {
  private auth: StandXAuth;
  private client: StandXClient;
  private ws: StandXWebSocket;
  private orderManager: OrderManager;
  private binanceClient: BinanceClient;
  private config = getConfig();

  // Bot state
  private state: BotState;
  private markPrice: Decimal = Decimal(0);
  private stopRequested: boolean = false;
  private startTime: number;
  private spreadSamples: Decimal[] = [];
  private spreadGuardTimer?: NodeJS.Timeout;
  private spreadGuardCooldownUntil = 0;
  private lastPositionCheckAt = 0;
  private positionCheckIntervalMs = 2000;

  constructor() {
    super();

    // Initialize auth
    this.auth = new StandXAuth(
      this.config.standx.privateKey,
      this.config.standx.address,
      this.config.standx.chain
    );

    // Initialize clients
    this.client = new StandXClient(this.auth);
    this.ws = new StandXWebSocket(this.auth);
    this.orderManager = new OrderManager(this.client, this.config.trading.symbol);
    this.binanceClient = new BinanceClient(this.config.binance.baseUrl);

    // Initialize state
    this.startTime = Date.now();
    this.state = {
      isRunning: false,
      markPrice: Decimal(0),
      position: Decimal(0),
      buyOrder: null,
      sellOrder: null,
      lastReplaceAt: {
        buy: 0,
        sell: 0
      },
      minReplaceIntervalMs: this.config.trading.minReplaceIntervalMs,
      stats: {
        ordersPlaced: 0,
        ordersCanceled: 0,
        ordersFilled: 0,
        startTime: this.startTime
      }
    };
  }

  /**
   * Start the bot
   */
  async start(): Promise<void> {
    try {
      log.info('🚀 Starting StandX Maker Points Bot...');
      this.stopRequested = false;

      // Initialize client
      log.info(`Initializing for ${this.config.trading.symbol}...`);
      await this.client.initialize(this.config.trading.symbol);
      log.info(`✅ Initialized for ${this.config.trading.symbol}`);

      // Connect WebSocket
      log.info('Connecting to WebSocket...');
      await this.ws.connect();
      log.info('✅ WebSocket connected');

      // Subscribe to channels
      log.info('Subscribing to channels...');
      this.ws.subscribeMarkPrice([this.config.trading.symbol]);
      this.ws.subscribeUserStreams();

      // Setup WebSocket event handlers
      this.setupWebSocketHandlers();

      // Wait for initial mark price from WebSocket
      log.info('Waiting for initial mark price from WebSocket...');
      await this.waitForMarkPrice();

      // Check and close any existing position
      log.info('Checking existing positions...');
      await this.ensureZeroPosition();

      // Set state to running
      this.state.isRunning = true;
      this.emit('state_changed', this.state);

      // Place initial orders
      log.info('Placing initial orders...');
      await this.placeInitialOrders();

      // Start spread guard monitoring
      this.startSpreadGuard();

      // Send startup notification
      if (telegram.isEnabled()) {
        await telegram.startup();
      }

      log.info('✅ Bot started successfully');
      this.emit('started');

    } catch (error: any) {
      log.error(`Failed to start bot: ${error.message}`);
      console.error('Stack trace:', error.stack);
      await telegram.error(`Bot startup failed: ${error.message}`);
      throw error;
    }
  }

  /**
   * Stop the bot
   */
  async stop(): Promise<void> {
    try {
      log.info('🛑 Stopping bot...');
      this.stopRequested = true;
      this.state.isRunning = false;

      // Cancel all orders
      await this.orderManager.cancelAllOrders();

      // Disconnect WebSocket
      this.ws.disconnect();

      // Stop spread guard
      this.stopSpreadGuard();

      // Send shutdown notification
      if (telegram.isEnabled()) {
        await telegram.shutdown();
      }

      log.info('✅ Bot stopped');
      this.emit('stopped');

    } catch (error: any) {
      log.error(`Error stopping bot: ${error.message}`);
    }
  }

  /**
   * Wait for initial mark price to be set
   */
  private async waitForMarkPrice(): Promise<void> {
    const maxWait = 10; // seconds
    const start = Date.now();

    while (this.markPrice.eq(0)) {
      if (Date.now() - start > maxWait * 1000) {
        throw new Error('Timeout waiting for mark price');
      }
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    log.info(`✅ Initial mark price: $${this.markPrice.toFixed(2)}`);
  }

  /**
   * Setup WebSocket event handlers
   */
  private setupWebSocketHandlers(): void {
    // Mark price updates
    this.ws.on('mark_price', (data: WSMarkPriceData) => {
      this.handleMarkPriceUpdate(data);
    });

    // Order updates
    this.ws.on('order_update', (data: WSOrderData) => {
      this.handleOrderUpdate(data);
    });

    // Position updates
    this.ws.on('position_update', (data: any) => {
      this.handlePositionUpdate(data);
    });

    // Reconnection events
    this.ws.on('reconnecting', (info: any) => {
      log.warn(`WebSocket reconnecting (attempt ${info.attempt})`);
      telegram.warning(`WebSocket reconnecting... (attempt ${info.attempt})`);
    });

    this.ws.on('market_reconnected', () => {
      log.info('✅ Market WebSocket reconnected');
      telegram.info('Market WebSocket reconnected');
      // Resubscribe
      this.ws.subscribeMarkPrice([this.config.trading.symbol]);
      this.ws.subscribeUserStreams();
      // Restore orders
      this.placeInitialOrders();
    });
  }

  /**
   * Handle mark price updates
   */
  private async handleMarkPriceUpdate(data: WSMarkPriceData): Promise<void> {
    try {
      const markPrice = new Decimal(data.markPrice);
      this.markPrice = markPrice;
      this.state.markPrice = markPrice;

      log.debug(`Mark price updated: $${markPrice.toFixed(2)}`);

      // Check if we need to cancel and replace orders
      await this.checkAndReplaceOrders();

    } catch (error: any) {
      log.error(`Error handling mark price update: ${error.message}`);
    }
  }

  /**
   * Handle order updates
   */
  private async handleOrderUpdate(data: WSOrderData): Promise<void> {
    try {
      const orderId = data.clientOrderId || data.orderId.toString();
      const status = data.status;

      log.debug(`Order update: ${orderId} - ${status}`);

      // Update our order tracking
      if (this.state.buyOrder && this.state.buyOrder.orderId === orderId) {
        this.state.buyOrder.status = status;
        this.state.buyOrder.filledQty = new Decimal(data.fillQty);
      }

      if (this.state.sellOrder && this.state.sellOrder.orderId === orderId) {
        this.state.sellOrder.status = status;
        this.state.sellOrder.filledQty = new Decimal(data.fillQty);
      }

      // Check if order was filled
      if (status === 'FILLED') {
        await this.handleOrderFilled(data);
      }

      this.emit('order_updated', this.state);

    } catch (error: any) {
      log.error(`Error handling order update: ${error.message}`);
    }
  }

  /**
   * Handle position updates
   */
  private async handlePositionUpdate(data: any): Promise<void> {
    try {
      const position = new Decimal(data.positionAmt || data.qty || 0);
      const previousPosition = this.state.position;
      this.state.position = position;
      this.lastPositionCheckAt = Date.now();

      log.debug(`Position updated: ${previousPosition} → ${position} BTC`);

      // Check if position changed from zero (an order was filled)
      if (previousPosition.abs().lt(new Decimal('0.00001')) && position.abs().gte(new Decimal('0.00001'))) {
        log.warn(`⚠️⚠️⚠️ POSITION DETECTED VIA WEBSOCKET ⚠️⚠️⚠️`);
        log.warn(`  Previous: ${previousPosition} BTC`);
        log.warn(`  Current: ${position} BTC`);

        // Close position immediately
        await this.closeDetectedPosition(position);
      }

      // Emit event
      this.emit('position_updated', position);

    } catch (error: any) {
      log.error(`Error handling position update: ${error.message}`);
    }
  }

  /**
   * Close detected position immediately
   */
  private async closeDetectedPosition(position: Decimal): Promise<void> {
    try {
      const positionSize = position.abs();
      const closeSide = position.gt(0) ? 'sell' : 'buy';

      log.warn(`🔄 Closing position via market order...`);
      log.warn(`  Size: ${positionSize} BTC`);
      log.warn(`  Side: ${closeSide}`);

      // Cancel all pending orders first
      await this.orderManager.cancelAllOrders();

      // Close position with market order
      const closed = await this.orderManager.closePosition(positionSize, closeSide);

      if (!closed) {
        log.error('❌ Failed to close position!');
        await telegram.error('Failed to close position! Manual intervention required!');
        // Stop the bot to prevent further damage
        await this.stop();
        return;
      }

      log.warn(`✅ Position closed successfully`);

      // Update position back to zero
      this.state.position = Decimal(0);

      // Wait a moment before placing new orders
      await new Promise(resolve => setTimeout(resolve, 1000));

      // Replace orders
      log.warn(`🔄 Replacing orders...`);
      await this.placeInitialOrders();

      // Send notification
      if (telegram.isEnabled()) {
        await telegram.warning('Position detected and closed via market order');
      }

    } catch (error: any) {
      log.error(`Error closing detected position: ${error.message}`);
      await telegram.error(`Error closing position: ${error.message}`);
      await this.stop();
    }
  }

  /**
   * Place initial orders
   */
  private async placeInitialOrders(): Promise<void> {
    try {
      const mode = this.config.trading.mode;

      // Cancel any existing orders
      await this.orderManager.cancelAllOrders();

      // Place orders based on mode
      if (mode === 'both' || mode === 'buy') {
        const buyPrice = this.orderManager.calculateOrderPrice(
          'buy',
          this.markPrice,
          this.config.trading.orderDistanceBp
        );

        const buyOrder = await this.orderManager.placeOrder(
          'buy',
          new Decimal(this.config.trading.orderSizeBtc),
          buyPrice
        );

        if (buyOrder) {
          this.state.buyOrder = buyOrder;
          this.state.stats.ordersPlaced++;
        }
      }

      if (mode === 'both' || mode === 'sell') {
        const sellPrice = this.orderManager.calculateOrderPrice(
          'sell',
          this.markPrice,
          this.config.trading.orderDistanceBp
        );

        const sellOrder = await this.orderManager.placeOrder(
          'sell',
          new Decimal(this.config.trading.orderSizeBtc),
          sellPrice
        );

        if (sellOrder) {
          this.state.sellOrder = sellOrder;
          this.state.stats.ordersPlaced++;
        }
      }

      this.emit('orders_placed', this.state);
      log.info('✅ Initial orders placed');

    } catch (error: any) {
      log.error(`Error placing initial orders: ${error.message}`);
    }
  }

  /**
   * Check and replace orders if mark price is outside valid range
   */
  private async checkAndReplaceOrders(): Promise<void> {
    if (!this.state.isRunning || this.stopRequested) {
      return;
    }

    if (this.markPrice.eq(0)) {
      return;
    }

    try {
      if (this.isSpreadGuardCoolingDown()) {
        log.warn('⏸️ Spread guard cooldown active, skipping order replacement.');
        return;
      }

      if (this.shouldRestoreOrders()) {
        log.info('🔄 Spread guard cooldown ended; restoring orders.');
        await this.placeInitialOrders();
        return;
      }

      // SAFETY CHECK: Verify position is zero (periodic REST check)
      const now = Date.now();
      if (now - this.lastPositionCheckAt >= this.positionCheckIntervalMs) {
        const currentPosition = await this.orderManager.getCurrentPosition();
        this.lastPositionCheckAt = now;
        this.state.position = currentPosition;
        if (currentPosition.abs().gte(new Decimal('0.00001'))) {
          log.error(`⚠️⚠️⚠️ NON-ZERO POSITION DETECTED IN CHECK LOOP ⚠️⚠️⚠️`);
          log.error(`  Position: ${currentPosition} BTC`);
          await this.closeDetectedPosition(currentPosition);
          return;
        }
      }

      const minDistanceBp = this.config.trading.minDistanceBp;
      const maxDistanceBp = this.config.trading.maxDistanceBp;
      const deadZoneBp = this.config.trading.replaceDeadZoneBp;
      const minReplaceBp = new Decimal(minDistanceBp).minus(deadZoneBp);
      const maxReplaceBp = new Decimal(maxDistanceBp).plus(deadZoneBp);

      // Check buy order
      if (this.state.buyOrder && this.state.buyOrder.status === 'OPEN') {
        const distance = this.markPrice
          .minus(this.state.buyOrder.price)
          .abs()
          .div(this.state.buyOrder.price)
          .mul(10000);

        // Replace if too close (risk of fill) or too far (no points)
        if (distance.lt(minReplaceBp)) {
          log.info(`[BUY] Too close to mark price (${distance.toFixed(2)} bp < ${minReplaceBp.toFixed(2)} bp), canceling and replacing...`);
          await this.replaceOrder('buy');
        } else if (distance.gt(maxReplaceBp)) {
          log.info(`[BUY] Too far from mark price (${distance.toFixed(2)} bp > ${maxReplaceBp.toFixed(2)} bp), canceling and replacing...`);
          await this.replaceOrder('buy');
        } else if (distance.lt(new Decimal(minDistanceBp))) {
          log.debug(`[BUY] Within dead-zone (${distance.toFixed(2)} bp < ${minDistanceBp} bp), skipping replace.`);
        } else if (distance.gt(new Decimal(maxDistanceBp))) {
          log.debug(`[BUY] Within dead-zone (${distance.toFixed(2)} bp > ${maxDistanceBp} bp), skipping replace.`);
        } else {
          log.debug(`[BUY] Order in valid range: ${distance.toFixed(2)} bp [${minDistanceBp}-${maxDistanceBp} bp]`);
        }
      }

      // Check sell order
      if (this.state.sellOrder && this.state.sellOrder.status === 'OPEN') {
        const distance = this.markPrice
          .minus(this.state.sellOrder.price)
          .abs()
          .div(this.state.sellOrder.price)
          .mul(10000);

        // Replace if too close (risk of fill) or too far (no points)
        if (distance.lt(minReplaceBp)) {
          log.info(`[SELL] Too close to mark price (${distance.toFixed(2)} bp < ${minReplaceBp.toFixed(2)} bp), canceling and replacing...`);
          await this.replaceOrder('sell');
        } else if (distance.gt(maxReplaceBp)) {
          log.info(`[SELL] Too far from mark price (${distance.toFixed(2)} bp > ${maxReplaceBp.toFixed(2)} bp), canceling and replacing...`);
          await this.replaceOrder('sell');
        } else if (distance.lt(new Decimal(minDistanceBp))) {
          log.debug(`[SELL] Within dead-zone (${distance.toFixed(2)} bp < ${minDistanceBp} bp), skipping replace.`);
        } else if (distance.gt(new Decimal(maxDistanceBp))) {
          log.debug(`[SELL] Within dead-zone (${distance.toFixed(2)} bp > ${maxDistanceBp} bp), skipping replace.`);
        } else {
          log.debug(`[SELL] Order in valid range: ${distance.toFixed(2)} bp [${minDistanceBp}-${maxDistanceBp} bp]`);
        }
      }

    } catch (error: any) {
      log.error(`Error in check and replace: ${error.message}`);
    }
  }

  /**
   * Replace an order
   */
  private async replaceOrder(side: OrderSide): Promise<void> {
    try {
      const now = Date.now();
      const lastReplaceAt = this.state.lastReplaceAt[side];
      if (now - lastReplaceAt < this.state.minReplaceIntervalMs) {
        log.debug(`[${side.toUpperCase()}] Replace throttled (${now - lastReplaceAt}ms < ${this.state.minReplaceIntervalMs}ms).`);
        return;
      }

      const order = side === 'buy' ? this.state.buyOrder : this.state.sellOrder;

      if (!order) {
        return;
      }

      log.info(`[${side.toUpperCase()}] Current order: ${order.price.toFixed(2)} (Mark: ${this.markPrice.toFixed(2)})`);

      // Cancel existing order
      log.info(`[${side.toUpperCase()}] Canceling order ${order.orderId}...`);
      const canceled = await this.orderManager.cancelOrder(order.orderId);

      if (canceled) {
        this.state.stats.ordersCanceled++;
        log.info(`[${side.toUpperCase()}] Order canceled successfully`);
      } else {
        log.warn(`[${side.toUpperCase()}] Order cancel failed (may already be filled)`);
      }

      // Calculate new price
      const newPrice = this.orderManager.calculateOrderPrice(
        side,
        this.markPrice,
        this.config.trading.orderDistanceBp
      );

      log.info(`[${side.toUpperCase()}] New price: $${newPrice.toFixed(2)}`);

      // Place new order
      const newOrder = await this.orderManager.placeOrder(
        side,
        new Decimal(this.config.trading.orderSizeBtc),
        newPrice
      );

      this.state.lastReplaceAt[side] = now;

      if (newOrder) {
        if (side === 'buy') {
          this.state.buyOrder = newOrder;
        } else {
          this.state.sellOrder = newOrder;
        }
        this.state.stats.ordersPlaced++;
        log.info(`[${side.toUpperCase()}] New order placed: ${newOrder.orderId} @ $${newOrder.price.toFixed(2)}`);
      }

      this.emit('order_replaced', { side, newOrder });
      log.info(`✅ [${side.toUpperCase()}] Order replaced successfully`);

    } catch (error: any) {
      log.error(`Error replacing ${side} order: ${error.message}`);
    }
  }

  /**
   * Handle order filled event
   */
  private async handleOrderFilled(data: WSOrderData): Promise<void> {
    try {
      const side = data.side;
      const qty = new Decimal(data.fillQty);
      const price = new Decimal(data.avgFillPrice || data.price);

      log.warn(`⚠️⚠️⚠️ ORDER FILLED ⚠️⚠️⚠️`);
      log.warn(`  Side: ${side.toUpperCase()}`);
      log.warn(`  Qty: ${qty} BTC`);
      log.warn(`  Price: $${price.toFixed(2)}`);
      log.warn(`  Order ID: ${data.orderId}`);

      this.state.stats.ordersFilled++;
      this.state.stats.lastTradeTime = Date.now();

      // Update position
      if (side === 'buy') {
        this.state.position = this.state.position.plus(qty);
      } else {
        this.state.position = this.state.position.minus(qty);
      }

      log.warn(`Current Position: ${this.state.position.toFixed(4)} BTC`);

      // Send Telegram notification
      if (telegram.isEnabled()) {
        await telegram.trade(side, qty.toString(), price.toFixed(2));
      }

      // Close position immediately
      log.warn(`🔄 Closing position immediately...`);
      const closeSide = side === 'buy' ? 'sell' : 'buy';
      const closed = await this.orderManager.closePosition(qty, closeSide);

      if (!closed) {
        log.error('❌ Failed to close position!');
        await telegram.error('Failed to close position!');
        // Stop the bot to prevent further damage
        await this.stop();
        return;
      }

      log.warn(`✅ Position closed successfully`);

      // Update position back to zero
      this.state.position = Decimal(0);

      // Replace the filled order
      log.warn(`🔄 Replacing ${side.toUpperCase()} order...`);
      await this.replaceOrder(side === 'buy' ? 'buy' : 'sell');

      this.emit('trade_executed', { side, qty, price: price.toString() });

    } catch (error: any) {
      log.error(`Error handling order filled: ${error.message}`);
      console.error(error.stack);
    }
  }

  private startSpreadGuard(): void {
    if (!this.config.spreadGuard.enabled) {
      log.info('Spread guard disabled.');
      return;
    }

    if (this.spreadGuardTimer) {
      clearInterval(this.spreadGuardTimer);
    }

    const intervalMs = this.config.spreadGuard.pollIntervalMs;
    this.spreadGuardTimer = setInterval(() => {
      this.checkBinanceSpread().catch((error: any) => {
        log.error(`Spread guard error: ${error.message}`);
      });
    }, intervalMs);

    log.info(`✅ Spread guard started (poll ${intervalMs} ms).`);
  }

  private stopSpreadGuard(): void {
    if (this.spreadGuardTimer) {
      clearInterval(this.spreadGuardTimer);
      this.spreadGuardTimer = undefined;
    }
  }

  private isSpreadGuardCoolingDown(): boolean {
    return Date.now() < this.spreadGuardCooldownUntil;
  }

  private async checkBinanceSpread(): Promise<void> {
    if (!this.state.isRunning || this.stopRequested) {
      return;
    }

    const { symbol } = this.config.binance;
    const { bestBid, bestAsk } = await this.binanceClient.fetchBbo(symbol);

    if (bestBid.lte(0) || bestAsk.lte(0)) {
      log.warn('Spread guard received invalid BBO data.');
      return;
    }

    const mid = bestBid.plus(bestAsk).div(2);
    const spreadBp = bestAsk.minus(bestBid).div(mid).mul(10000);
    const markPrice = this.markPrice;
    const basisDiffThreshold = new Decimal(this.config.spreadGuard.basisDiffBp);
    const basisDiffBp = markPrice.gt(0)
      ? markPrice.minus(mid).abs().div(mid).mul(10000)
      : new Decimal(0);
    const basisDiffActive = basisDiffThreshold.gt(0) && basisDiffBp.gte(basisDiffThreshold);

    this.updateSpreadSamples(spreadBp);
    const baseline = this.calculateSpreadBaseline();

    const jumpThresholdBase = new Decimal(this.config.spreadGuard.jumpSpreadBp);
    const maxSpreadBase = this.calculateDynamicMaxSpread();
    const { regime, jumpMultiplier, maxMultiplier, volatility } = this.getRegimeAdjustments();
    const basisDiffMultiplier = basisDiffActive
      ? new Decimal(this.config.spreadGuard.basisDiffGuardMultiplier)
      : Decimal(1);
    const jumpThreshold = jumpThresholdBase.mul(jumpMultiplier).mul(basisDiffMultiplier);
    const maxSpread = maxSpreadBase.mul(maxMultiplier).mul(basisDiffMultiplier);

    if (this.isSpreadGuardCoolingDown()) {
      return;
    }

    const spreadJumped = baseline.gt(0) && spreadBp.minus(baseline).gte(jumpThreshold);
    const spreadTooWide = spreadBp.gte(maxSpread);

    if (spreadJumped || spreadTooWide) {
      const basisDiffNote = basisDiffActive
        ? ` (basis diff ${basisDiffBp.toFixed(2)} bp ≥ ${basisDiffThreshold.toFixed(2)} bp, guard sensitivity reduced)`
        : '';
      const reason = spreadTooWide
        ? `spread ${spreadBp.toFixed(2)} bp ≥ max ${maxSpread.toFixed(2)} bp`
        : `spread jumped ${spreadBp.toFixed(2)} bp (baseline ${baseline.toFixed(2)} bp, jump ${jumpThreshold.toFixed(2)} bp)`;
      log.warn(
        `🚨 Binance spread widening detected (${regime} vol=${volatility.toFixed(2)} bp): ${reason}${basisDiffNote}. Canceling orders.`
      );
      await this.orderManager.cancelAllOrders();
      this.state.buyOrder = null;
      this.state.sellOrder = null;
      this.spreadGuardCooldownUntil = Date.now() + this.config.spreadGuard.cooldownMs;

      if (telegram.isEnabled()) {
        await telegram.warning(`Spread guard triggered: ${reason}${basisDiffNote}. Orders canceled.`);
      }
    }
  }

  private updateSpreadSamples(spreadBp: Decimal): void {
    this.spreadSamples.push(spreadBp);
    const maxSamples = Math.max(
      this.config.spreadGuard.lookbackSamples,
      this.config.spreadGuard.quantileSamples,
      this.config.spreadGuard.volLookbackSamples
    );
    if (this.spreadSamples.length > maxSamples) {
      this.spreadSamples.shift();
    }
  }

  private calculateSpreadBaseline(): Decimal {
    const samples = this.getRecentSamples(this.config.spreadGuard.lookbackSamples);
    if (samples.length === 0) {
      return Decimal(0);
    }

    const total = samples.reduce((sum, value) => sum.plus(value), Decimal(0));
    return total.div(samples.length);
  }

  private calculateDynamicMaxSpread(): Decimal {
    const samples = this.getRecentSamples(this.config.spreadGuard.quantileSamples);
    const quantile = this.config.spreadGuard.maxQuantile;
    const quantileValue = this.calculateSpreadQuantile(samples, quantile);
    if (quantileValue.gt(0)) {
      return quantileValue;
    }
    return new Decimal(this.config.spreadGuard.maxSpreadBp);
  }

  private getRegimeAdjustments(): {
    regime: 'low' | 'normal' | 'high';
    volatility: Decimal;
    jumpMultiplier: Decimal;
    maxMultiplier: Decimal;
  } {
    const volSamples = this.getRecentSamples(this.config.spreadGuard.volLookbackSamples);
    const volatility = this.calculateSpreadVolatility(volSamples);
    const regime = this.determineSpreadRegime(volatility);

    if (regime === 'high') {
      return {
        regime,
        volatility,
        jumpMultiplier: new Decimal(this.config.spreadGuard.highVolJumpMultiplier),
        maxMultiplier: new Decimal(this.config.spreadGuard.highVolMaxMultiplier)
      };
    }

    if (regime === 'low') {
      return {
        regime,
        volatility,
        jumpMultiplier: new Decimal(this.config.spreadGuard.lowVolJumpMultiplier),
        maxMultiplier: new Decimal(this.config.spreadGuard.lowVolMaxMultiplier)
      };
    }

    return {
      regime: 'normal',
      volatility,
      jumpMultiplier: Decimal(1),
      maxMultiplier: Decimal(1)
    };
  }

  private getRecentSamples(limit: number): Decimal[] {
    if (limit <= 0) {
      return [];
    }
    return this.spreadSamples.slice(-limit);
  }

  private calculateSpreadQuantile(samples: Decimal[], quantile: number): Decimal {
    if (samples.length === 0) {
      return Decimal(0);
    }

    const clampedQuantile = Math.min(1, Math.max(0, quantile));
    const sorted = samples
      .map((value) => value.toNumber())
      .sort((a, b) => a - b);

    if (sorted.length === 1) {
      return new Decimal(sorted[0]);
    }

    const position = (sorted.length - 1) * clampedQuantile;
    const lowerIndex = Math.floor(position);
    const upperIndex = Math.ceil(position);
    const lowerValue = sorted[lowerIndex];
    const upperValue = sorted[upperIndex];
    const weight = position - lowerIndex;
    const interpolated = lowerValue + (upperValue - lowerValue) * weight;
    return new Decimal(interpolated);
  }

  private calculateSpreadVolatility(samples: Decimal[]): Decimal {
    if (samples.length < 2) {
      return Decimal(0);
    }

    const values = samples.map((value) => value.toNumber());
    const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
    const variance =
      values.reduce((sum, value) => sum + Math.pow(value - mean, 2), 0) / values.length;
    return new Decimal(Math.sqrt(variance));
  }

  private determineSpreadRegime(volatility: Decimal): 'low' | 'normal' | 'high' {
    const high = new Decimal(this.config.spreadGuard.volHighThresholdBp);
    const low = new Decimal(this.config.spreadGuard.volLowThresholdBp);

    if (volatility.gte(high)) {
      return 'high';
    }
    if (volatility.lte(low)) {
      return 'low';
    }
    return 'normal';
  }

  private shouldRestoreOrders(): boolean {
    if (!this.state.isRunning || this.stopRequested) {
      return false;
    }

    if (this.isSpreadGuardCoolingDown()) {
      return false;
    }

    if (this.markPrice.eq(0)) {
      return false;
    }

    const mode = this.config.trading.mode;
    const needsBuy = mode === 'both' || mode === 'buy';
    const needsSell = mode === 'both' || mode === 'sell';
    const buyOpen = this.state.buyOrder?.status === 'OPEN';
    const sellOpen = this.state.sellOrder?.status === 'OPEN';

    return (needsBuy && !buyOpen) || (needsSell && !sellOpen);
  }

  /**
   * Ensure zero position
   */
  private async ensureZeroPosition(): Promise<void> {
    try {
      const position = await this.client.getPosition(this.config.trading.symbol);

      if (position.abs().gt(0)) {
        log.warn(`Existing position detected: ${position} BTC`);
        await telegram.warning(`Existing position: ${position} BTC, closing...`);

        const side = position.gt(0) ? 'sell' : 'buy';
        const closed = await this.orderManager.closePosition(position.abs(), side);

        if (closed) {
          log.info('✅ Existing position closed');
        } else {
          log.error('Failed to close existing position!');
          throw new Error('Failed to close existing position');
        }
      }

    } catch (error: any) {
      log.error(`Error ensuring zero position: ${error.message}`);
      throw error;
    }
  }

  /**
   * Get bot state
   */
  getState(): BotState {
    return { ...this.state };
  }

  /**
   * Get bot uptime
   */
  getUptime(): string {
    const uptime = Date.now() - this.startTime;
    const hours = Math.floor(uptime / 3600000);
    const minutes = Math.floor((uptime % 3600000) / 60000);
    return `${hours}h ${minutes}m`;
  }

  /**
   * Check if bot is running
   */
  isRunning(): boolean {
    return this.state.isRunning;
  }
}
