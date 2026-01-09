import Decimal from 'decimal.js';
import { StandXClient } from '../api/standx-client';
import { OrderInfo, OrderSide, OrderStatus } from '../types';
import { log } from '../utils/logger';

/**
 * Order Manager
 * Handles order placement, cancellation, and tracking
 */
export class OrderManager {
  private client: StandXClient;
  private tickSize: Decimal;
  private symbol: string;

  constructor(client: StandXClient, symbol: string) {
    this.client = client;
    this.symbol = symbol;
    this.tickSize = client.getTickSize();
  }

  /**
   * Calculate order price based on mark price and distance
   */
  calculateOrderPrice(side: OrderSide, markPrice: Decimal, distanceBp: number): Decimal {
    const multiplier = side === 'buy'
      ? new Decimal(1).minus(new Decimal(distanceBp).div(10000))
      : new Decimal(1).plus(new Decimal(distanceBp).div(10000));

    const rawPrice = markPrice.mul(multiplier);
    return this.roundToTickSize(rawPrice);
  }

  /**
   * Place a new order
   */
  async placeOrder(
    side: OrderSide,
    qty: Decimal,
    price: Decimal,
    reduceOnly: boolean = false,
    orderType: 'limit' | 'market' = 'limit'
  ): Promise<OrderInfo | null> {
    try {
      const roundedPrice = this.roundToTickSize(price);

      if (orderType === 'market') {
        log.info(`Placing MARKET ${side} order: ${qty} BTC`);
      } else {
        log.info(`Placing ${side} order: ${qty} BTC @ $${roundedPrice}`);
      }

      const result = await this.client.placeOrder(
        this.symbol,
        side,
        qty,
        roundedPrice,
        reduceOnly,
        orderType
      );

      if (!result.success) {
        log.error(`Failed to place ${side} order: ${result.errorMessage}`);
        return null;
      }

      const orderInfo: OrderInfo = {
        orderId: result.orderId || '',
        clientOrderId: result.orderId || '',
        symbol: this.symbol,
        side: result.side || side,
        qty: result.size || qty,
        price: result.price || (orderType === 'market' ? Decimal(0) : roundedPrice),
        filledQty: orderType === 'market' ? qty : Decimal(0),
        status: result.status || (orderType === 'market' ? 'FILLED' : 'OPEN')
      };

      log.info(`✅ ${side} order placed: ${orderInfo.orderId}`);
      return orderInfo;

    } catch (error: any) {
      log.error(`Error placing ${side} order: ${error.message}`);
      return null;
    }
  }

  /**
   * Cancel an order
   */
  async cancelOrder(orderId: string): Promise<boolean> {
    try {
      log.info(`Canceling order: ${orderId}`);

      const success = await this.client.cancelOrder(orderId);

      if (success) {
        log.info(`✅ Order canceled: ${orderId}`);
      } else {
        log.warn(`Failed to cancel order: ${orderId}`);
      }

      return success;

    } catch (error: any) {
      log.error(`Error canceling order: ${error.message}`);
      return false;
    }
  }

  /**
   * Cancel all open orders
   */
  async cancelAllOrders(): Promise<void> {
    try {
      const orders = await this.client.getOpenOrders(this.symbol);

      log.info(`Found ${orders.length} open orders to cancel`);

      for (const order of orders) {
        await this.cancelOrder(order.orderId);
      }

    } catch (error: any) {
      log.error(`Error canceling all orders: ${error.message}`);
    }
  }

  /**
   * Get order info
   */
  async getOrderInfo(orderId: string): Promise<OrderInfo | null> {
    try {
      return await this.client.getOrderInfo(orderId);
    } catch (error: any) {
      log.error(`Error getting order info: ${error.message}`);
      return null;
    }
  }

  /**
   * Wait for order to fill
   */
  async waitForOrderFill(orderId: string, timeoutMs: number = 30000): Promise<OrderInfo | null> {
    const startTime = Date.now();

    while (Date.now() - startTime < timeoutMs) {
      const orderInfo = await this.getOrderInfo(orderId);

      if (!orderInfo) {
        await this.sleep(500);
        continue;
      }

      if (orderInfo.status === 'FILLED') {
        log.info(`Order filled: ${orderId}`);
        return orderInfo;
      }

      if (orderInfo.status === 'CANCELED' || orderInfo.status === 'FAILED') {
        log.warn(`Order ${orderInfo.status}: ${orderId}`);
        return orderInfo;
      }

      await this.sleep(500);
    }

    log.error(`Timeout waiting for order fill: ${orderId}`);
    return null;
  }

  /**
   * Close position with market, limit, or adaptive price
   */
  async closePosition(
    qty: Decimal,
    side: OrderSide,
    options?: {
      mode?: 'market' | 'limit' | 'adaptive';
      price?: Decimal;
      maxWaitMs?: number;
    }
  ): Promise<boolean> {
    const mode = options?.mode ?? 'market';
    const maxWaitMs = options?.maxWaitMs ?? 5000;

    try {
      if (mode === 'market') {
        return await this.closeWithMarketOrder(qty, side);
      }

      if (!options?.price) {
        log.error(`Missing ${mode} price for closing position`);
        return false;
      }

      const priceLabel = mode === 'adaptive' ? 'ADAPTIVE LIMIT' : 'LIMIT';
      log.warn(`🔄 Closing ${side} position: ${qty} BTC with ${priceLabel} @ $${options.price}`);

      const limitOrder = await this.placeOrder(side, qty, options.price, true, 'limit');

      if (!limitOrder) {
        log.error('Failed to place close limit order');
        return false;
      }

      const filledOrder = await this.waitForOrderFill(limitOrder.orderId, maxWaitMs);

      if (filledOrder && filledOrder.status === 'FILLED') {
        log.warn(`✅ Position closed with ${priceLabel}: ${qty} BTC`);
        return true;
      }

      log.warn(`⏳ ${priceLabel} not filled within ${maxWaitMs} ms, falling back to MARKET`);
      await this.cancelOrder(limitOrder.orderId);
      return await this.closeWithMarketOrder(qty, side);

    } catch (error: any) {
      log.error(`Error closing position: ${error.message}`);
      return false;
    }
  }

  private async closeWithMarketOrder(qty: Decimal, side: OrderSide): Promise<boolean> {
    log.warn(`🔄 Closing ${side} position: ${qty} BTC with MARKET order`);

    const result = await this.placeOrder(side, qty, Decimal(0), true, 'market');

    if (!result) {
      log.error('Failed to place close market order');
      return false;
    }

    if (result.status === 'FILLED') {
      log.warn(`✅ Position closed immediately: ${qty} BTC`);
      return true;
    }

    log.info(`Waiting for market order confirmation...`);
    const filledOrder = await this.waitForOrderFill(result.orderId, 5000);

    if (filledOrder && filledOrder.status === 'FILLED') {
      log.warn(`✅ Position closed: ${qty} BTC`);
      return true;
    }

    log.error('Failed to close position');
    return false;
  }

  /**
   * Round price to tick size
   */
  private roundToTickSize(price: Decimal): Decimal {
    const ticks = price.div(this.tickSize);
    const rounded = ticks.toDecimalPlaces(0, Decimal.ROUND_HALF_UP);
    return rounded.mul(this.tickSize);
  }

  /**
   * Sleep helper
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Check if price is within threshold
   */
  isPriceWithinThreshold(
    orderPrice: Decimal,
    markPrice: Decimal,
    thresholdBp: number
  ): boolean {
    const distance = markPrice
      .minus(orderPrice)
      .abs()
      .div(orderPrice)
      .mul(10000);

    return distance.lte(new Decimal(thresholdBp));
  }

  /**
   * Get current position
   */
  async getCurrentPosition(): Promise<Decimal> {
    try {
      return await this.client.getPosition(this.symbol);
    } catch (error: any) {
      log.error(`Error getting position: ${error.message}`);
      return Decimal(0);
    }
  }
}
