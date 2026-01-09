import Decimal from 'decimal.js';
import { EventEmitter } from 'eventemitter3';
import axios from 'axios';
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
  private binanceClient: BinanceClient;
  private orderManager: OrderManager;
  private config = getConfig();

  // Bot state
  private state: BotState;
  private markPrice: Decimal = Decimal(0);
  private stopRequested: boolean = false;
  private startTime: number;
  private spreadSamples: Array<{ timestamp: number; spreadBp: Decimal }> = [];
  private lastBinanceCheckAt: number = 0;
  private lastSpreadGuardCancelAt: number = 0;

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
    this.binanceClient = new BinanceClient();
    this.orderManager = new OrderManager(this.client, this.config.trading.symbol);

    // Initialize state
    this.startTime = Date.now();
    this.state = {
      isRunning: false,
      markPrice: Decimal(0),
      position: Decimal(0),
      buyOrder: null,
      sellOrder: null,
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

      // Start spread monitor
      this.startSpreadMonitor();

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

      // Stop spread monitor
      this.stopSpreadMonitor();

      // Disconnect WebSocket
      this.ws.disconnect();

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
      if (this.isSpreadCancelCooldownActive()) {
        log.warn('Spread cooldown active, skipping order placement');
        return;
      }

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

    if (this.isSpreadCancelCooldownActive()) {
      return;
    }

    try {
      // SAFETY CHECK: Verify position is zero
      const currentPosition = await this.orderManager.getCurrentPosition();
      if (currentPosition.abs().gte(new Decimal('0.00001'))) {
        log.error(`⚠️⚠️⚠️ NON-ZERO POSITION DETECTED IN CHECK LOOP ⚠️⚠️⚠️`);
        log.error(`  Position: ${currentPosition} BTC`);
        await this.closeDetectedPosition(currentPosition);
        return;
      }

      const spreadGuardTriggered = await this.enforceSpreadGuard();
      if (spreadGuardTriggered) {
        return;
      }

      const minDistanceBp = this.config.trading.minDistanceBp;
      const maxDistanceBp = this.config.trading.maxDistanceBp;

      // Check buy order
      if (this.state.buyOrder && this.state.buyOrder.status === 'OPEN') {
        const distance = this.markPrice
          .minus(this.state.buyOrder.price)
          .abs()
          .div(this.state.buyOrder.price)
          .mul(10000);

        // Replace if too close (risk of fill) or too far (no points)
        if (distance.lt(new Decimal(minDistanceBp))) {
          log.info(`[BUY] Too close to mark price (${distance.toFixed(2)} bp < ${minDistanceBp} bp), canceling and replacing...`);
          await this.replaceOrder('buy');
        } else if (distance.gt(new Decimal(maxDistanceBp))) {
          log.info(`[BUY] Too far from mark price (${distance.toFixed(2)} bp > ${maxDistanceBp} bp), canceling and replacing...`);
          await this.replaceOrder('buy');
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
        if (distance.lt(new Decimal(minDistanceBp))) {
          log.info(`[SELL] Too close to mark price (${distance.toFixed(2)} bp < ${minDistanceBp} bp), canceling and replacing...`);
          await this.replaceOrder('sell');
        } else if (distance.gt(new Decimal(maxDistanceBp))) {
          log.info(`[SELL] Too far from mark price (${distance.toFixed(2)} bp > ${maxDistanceBp} bp), canceling and replacing...`);
          await this.replaceOrder('sell');
        } else {
          log.debug(`[SELL] Order in valid range: ${distance.toFixed(2)} bp [${minDistanceBp}-${maxDistanceBp} bp]`);
        }
      }

    } catch (error: any) {
      log.error(`Error in check and replace: ${error.message}`);
    }
  }

  /**
   * Fetch Binance BBO prices for spread guard
   */
  private async fetchBinanceBbo(): Promise<[Decimal, Decimal]> {
    const baseUrl = this.config.binance.baseUrl.replace(/\/$/, '');
    const symbol = this.config.binance.symbol;
    const response = await axios.get(`${baseUrl}/api/v3/ticker/bookTicker`, {
      params: { symbol }
    });
    const bidPrice = new Decimal(response.data.bidPrice || 0);
    const askPrice = new Decimal(response.data.askPrice || 0);
    return [bidPrice, askPrice];
  }

  /**
   * Enforce spread guard based on Binance BBO data
   */
  private async enforceSpreadGuard(): Promise<boolean> {
    if (!this.config.binance.enabled) {
      return false;
    }

    const now = Date.now();
    const cooldownMs = this.config.spreadGuard.cooldownMs;
    if (this.lastSpreadGuardCancelAt > 0 && now - this.lastSpreadGuardCancelAt < cooldownMs) {
      log.debug('Spread guard cooldown active, skipping order updates');
      return true;
    }

    if (now - this.lastBinanceCheckAt < 1000) {
      return false;
    }
    this.lastBinanceCheckAt = now;

    try {
      const [bestBid, bestAsk] = await this.fetchBinanceBbo();
      if (bestBid.lte(0) || bestAsk.lte(0)) {
        return false;
      }

      const spreadBp = bestAsk
        .minus(bestBid)
        .div(bestAsk.plus(bestBid).div(2))
        .mul(10000);

      this.recordSpreadSample(spreadBp, now);
      const baseline = this.getBaselineSpreadBp();

      const spreadJumpBp = new Decimal(this.config.spreadGuard.spreadJumpBp);
      const maxSpreadBp = new Decimal(this.config.spreadGuard.maxSpreadBp);

      const jumpDetected = baseline ? spreadBp.minus(baseline).gte(spreadJumpBp) : false;
      const maxDetected = spreadBp.gte(maxSpreadBp);

      if (jumpDetected || maxDetected) {
        log.warn('⚠️ Spread guard triggered, canceling all orders');
        log.warn(`  Binance ${this.config.binance.symbol} spread: ${spreadBp.toFixed(2)} bp`);
        if (baseline) {
          log.warn(`  Baseline spread: ${baseline.toFixed(2)} bp`);
        }
        await this.orderManager.cancelAllOrders();
        this.lastSpreadGuardCancelAt = now;
        return true;
      }

      return false;
    } catch (error: any) {
      log.warn(`Spread guard check failed: ${error.message}`);
      return false;
    }
  }

  private recordSpreadSample(spreadBp: Decimal, timestamp: number): void {
    this.spreadSamples.push({ spreadBp, timestamp });
    const lookbackWindowMs = this.config.spreadGuard.lookbackWindowMs;
    const cutoff = timestamp - lookbackWindowMs;
    this.spreadSamples = this.spreadSamples.filter(sample => sample.timestamp >= cutoff);
    const rollingSamples = this.config.spreadGuard.rollingSamples;
    if (this.spreadSamples.length > rollingSamples) {
      this.spreadSamples = this.spreadSamples.slice(-rollingSamples);
    }
  }

  private getBaselineSpreadBp(): Decimal | null {
    if (this.spreadSamples.length === 0) {
      return null;
    }
    const total = this.spreadSamples.reduce(
      (sum, sample) => sum.plus(sample.spreadBp),
      Decimal(0)
    );
    return total.div(this.spreadSamples.length);
  }

  /**
   * Replace an order
   */
  private async replaceOrder(side: OrderSide): Promise<void> {
    try {
      if (this.isSpreadCancelCooldownActive()) {
        log.warn(`[${side.toUpperCase()}] Spread cooldown active, skipping order replace`);
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

  private startSpreadMonitor(): void {
    if (this.spreadMonitorTimer) {
      clearInterval(this.spreadMonitorTimer);
    }

    const intervalMs = this.config.trading.spreadCheckIntervalMs;
    this.spreadMonitorTimer = setInterval(() => {
      this.checkSpreadAndCancelIfNeeded().catch(error => {
        log.error(`Error in spread monitor: ${error.message}`);
      });
    }, intervalMs);

    log.info(`Spread monitor started (interval ${intervalMs} ms)`);
  }

  private stopSpreadMonitor(): void {
    if (this.spreadMonitorTimer) {
      clearInterval(this.spreadMonitorTimer);
      this.spreadMonitorTimer = undefined;
    }
  }

  private isSpreadCancelCooldownActive(): boolean {
    return Date.now() < this.spreadCancelCooldownUntil;
  }

  private getSpreadBaseline(): number | null {
    if (this.spreadHistory.length === 0) {
      return null;
    }

    const sum = this.spreadHistory.reduce((total, value) => total + value, 0);
    return sum / this.spreadHistory.length;
  }

  private recordSpread(spreadBp: number): void {
    this.spreadHistory.push(spreadBp);
    const windowSize = this.config.trading.spreadBaselineWindow;

    if (this.spreadHistory.length > windowSize) {
      this.spreadHistory.shift();
    }
  }

  private async checkSpreadAndCancelIfNeeded(): Promise<void> {
    if (!this.state.isRunning || this.stopRequested) {
      return;
    }

    try {
      const ticker = await this.binanceClient.getBookTicker(this.config.trading.binanceSymbol);
      const bestBid = new Decimal(ticker.bidPrice);
      const bestAsk = new Decimal(ticker.askPrice);

      if (bestBid.lte(0) || bestAsk.lte(0)) {
        return;
      }

      const mid = bestBid.plus(bestAsk).div(2);
      if (mid.eq(0)) {
        return;
      }

      const spreadBp = bestAsk.minus(bestBid).div(mid).mul(10000).toNumber();
      const baseline = this.getSpreadBaseline();
      this.recordSpread(spreadBp);

      const spreadJumpBp = baseline !== null ? spreadBp - baseline : 0;
      const exceedsMaxSpread = spreadBp > this.config.trading.maxSpreadBp;
      const exceedsJump = baseline !== null && spreadJumpBp > this.config.trading.spreadJumpBp;

      if ((exceedsMaxSpread || exceedsJump) && !this.isSpreadCancelCooldownActive()) {
        const reason = exceedsMaxSpread
          ? `spread ${spreadBp.toFixed(2)} bp > max ${this.config.trading.maxSpreadBp} bp`
          : `spread jump ${spreadJumpBp.toFixed(2)} bp > ${this.config.trading.spreadJumpBp} bp`;

        log.warn(`Binance spread widened (${reason}), canceling orders`);
        if (telegram.isEnabled()) {
          await telegram.warning(`Binance spread widened (${reason}), canceling orders`);
        }

        await this.orderManager.cancelAllOrders();
        this.spreadCancelCooldownUntil = Date.now() + this.config.trading.spreadCancelCooldownMs;
      }

      if (!this.isSpreadCancelCooldownActive() && this.shouldRestoreOrders()) {
        await this.placeInitialOrders();
      }
    } catch (error: any) {
      log.error(`Failed to fetch Binance spread: ${error.message}`);
    }
  }

  private shouldRestoreOrders(): boolean {
    const mode = this.config.trading.mode;
    const needsBuy = mode === 'both' || mode === 'buy';
    const needsSell = mode === 'both' || mode === 'sell';
    const buyOpen = this.state.buyOrder?.status === 'OPEN';
    const sellOpen = this.state.sellOrder?.status === 'OPEN';

    return (needsBuy && !buyOpen) || (needsSell && !sellOpen);
  }
}
