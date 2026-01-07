import axios, { AxiosInstance } from 'axios';
import { v4 as uuidv4 } from 'uuid';
import Decimal from 'decimal.js';
import { StandXAuth } from './standx-auth';
import { OrderInfo, OrderResult, ContractInfo, OrderSide } from '../types';

/**
 * StandX REST API Client
 * Handles all HTTP API calls to StandX
 */
export class StandXClient {
  private auth: StandXAuth;
  private baseUrl: string;
  private client: AxiosInstance;
  private sessionId: string;
  private tickSize: Decimal = Decimal('0.1');
  private contractId: string = '';

  constructor(auth: StandXAuth) {
    this.auth = auth;
    this.baseUrl = 'https://perps.standx.com';
    this.sessionId = uuidv4();

    this.client = axios.create({
      timeout: 10000,
      httpsAgent: undefined // Disable SSL verification for now
    });
  }

  /**
   * Initialize client by fetching contract info
   */
  async initialize(symbol: string): Promise<void> {
    const contractInfo = await this.getContractInfo(symbol);
    this.contractId = contractInfo.symbol;
    this.tickSize = contractInfo.tickSize;
  }

  /**
   * Get contract information
   */
  async getContractInfo(symbol: string): Promise<ContractInfo> {
    try {
      const response = await this.client.get(`${this.baseUrl}/api/query_symbol_info`);
      const data = response.data;

      if (!Array.isArray(data)) {
        throw new Error('Invalid symbol info response');
      }

      const contract = data.find((c: any) =>
        c.symbol === symbol ||
        c.base_asset === symbol ||
        c.symbol === `${symbol}-USD` ||
        c.symbol === `${symbol}-PERP`
      );

      if (!contract) {
        throw new Error(`Contract not found for ${symbol}`);
      }

      const tickSize = contract.price_tick_decimals !== undefined
        ? new Decimal(1).div(new Decimal(10).pow(contract.price_tick_decimals))
        : new Decimal('0.1');

      return {
        symbol: contract.symbol,
        baseAsset: contract.base_asset,
        tickSize: tickSize,
        minOrderQty: new Decimal(contract.min_order_qty || '0.001'),
        priceTickDecimals: contract.price_tick_decimals || 1
      };
    } catch (error: any) {
      throw new Error(`Failed to get contract info: ${error.message}`);
    }
  }

  /**
   * Place a new order
   */
  async placeOrder(
    symbol: string,
    side: OrderSide,
    qty: Decimal,
    price: Decimal,
    reduceOnly: boolean = false,
    orderType: 'limit' | 'market' = 'limit'
  ): Promise<OrderResult> {
    try {
      const clientOrderId = `bot-${uuidv4().replace(/-/g, '').substring(0, 16)}`;
      const timestamp = Date.now();

      const params: any = {
        symbol,
        side,
        order_type: orderType,
        qty: qty.toString(),
        reduce_only: reduceOnly,
        cl_ord_id: clientOrderId
      };

      // Only add price and time_in_force for limit orders
      if (orderType === 'limit') {
        params.price = price.toString();
        params.time_in_force = 'gtc';
      }

      const payload = JSON.stringify(params);
      const headers = this.buildHeaders(payload, timestamp);

      const response = await this.client.post(
        `${this.baseUrl}/api/new_order`,
        payload,
        { headers }
      );

      if (response.data.code !== 0) {
        return {
          success: false,
          errorMessage: response.data.message || 'Unknown error'
        };
      }

      return {
        success: true,
        orderId: clientOrderId,
        price: orderType === 'market' ? Decimal(0) : price,
        size: qty,
        side,
        status: orderType === 'market' ? 'FILLED' : 'OPEN'
      };
    } catch (error: any) {
      return {
        success: false,
        errorMessage: error.message
      };
    }
  }

  /**
   * Cancel an order
   */
  async cancelOrder(orderId: string): Promise<boolean> {
    try {
      // If it's a client order ID, we need to find the real order ID first
      if (orderId.startsWith('bot-')) {
        const orderInfo = await this.getOrderInfo(orderId);
        if (!orderInfo || orderInfo.orderId === 'None') {
          return false;
        }
        orderId = orderInfo.orderId;
      }

      const timestamp = Date.now();
      const params = { order_id: parseInt(orderId) };
      const payload = JSON.stringify(params);
      const headers = this.buildHeaders(payload, timestamp);

      const response = await this.client.post(
        `${this.baseUrl}/api/cancel_order`,
        payload,
        { headers }
      );

      return response.data.message === 'success';
    } catch (error) {
      return false;
    }
  }

  /**
   * Get order information
   */
  async getOrderInfo(orderId: string): Promise<OrderInfo | null> {
    try {
      const timestamp = Date.now();
      let params: any = {};

      if (orderId.startsWith('bot-')) {
        params.cl_ord_id = orderId;
      } else {
        params.order_id = parseInt(orderId);
      }

      const headers = {
        'Authorization': `Bearer ${this.auth.getAccessToken()}`,
        'x-session-id': this.sessionId
      };

      const response = await this.client.get(`${this.baseUrl}/api/query_order`, {
        params,
        headers
      });

      const data = response.data;

      return {
        orderId: data.id?.toString() || orderId,
        clientOrderId: data.cl_ord_id || orderId,
        symbol: data.symbol || this.contractId,
        side: data.side || 'buy',
        qty: new Decimal(data.qty || 0),
        price: this.roundPrice(new Decimal(data.price || 0)),
        filledQty: new Decimal(data.fill_qty || 0),
        status: (data.status || 'OPEN').toUpperCase()
      };
    } catch (error) {
      return null;
    }
  }

  /**
   * Get open orders
   */
  async getOpenOrders(symbol: string): Promise<OrderInfo[]> {
    try {
      const headers = {
        'Authorization': `Bearer ${this.auth.getAccessToken()}`,
        'x-session-id': this.sessionId
      };

      const response = await this.client.get(`${this.baseUrl}/api/query_open_orders`, {
        params: { symbol },
        headers
      });

      // API returns { code, message, result: [...] }
      const data = response.data;
      const orders = data.result || data;

      if (!Array.isArray(orders)) {
        return [];
      }

      return orders.map((o: any) => ({
        orderId: o.id?.toString() || o.order_id?.toString() || 'Unknown',
        clientOrderId: o.cl_ord_id || '',
        symbol: o.symbol || symbol,
        side: o.side || 'buy',
        qty: new Decimal(o.qty || 0),
        price: new Decimal(o.price || 0),
        filledQty: new Decimal(o.fill_qty || o.cum_qty || 0),
        status: 'OPEN'
      }));
    } catch (error) {
      return [];
    }
  }

  /**
   * Get current position
   */
  async getPosition(symbol: string): Promise<Decimal> {
    try {
      const headers = {
        'Authorization': `Bearer ${this.auth.getAccessToken()}`,
        'x-session-id': this.sessionId
      };

      const response = await this.client.get(`${this.baseUrl}/api/query_positions`, {
        params: { symbol },
        headers
      });

      const positions = response.data;
      if (!Array.isArray(positions)) {
        return Decimal(0);
      }

      for (const p of positions) {
        const sym = p.symbol || p.contract_id || p.contractId;
        if (sym === symbol || sym === this.contractId) {
          const qty = p.qty || p.size || p.positionAmt || 0;
          return new Decimal(qty.toString());
        }
      }

      return Decimal(0);
    } catch (error) {
      return Decimal(0);
    }
  }

  /**
   * Fetch BBO prices
   */
  async fetchBBOPrices(symbol: string): Promise<[Decimal, Decimal]> {
    try {
      const response = await this.client.get(`${this.baseUrl}/api/query_depth_book`, {
        params: { symbol }
      });

      const { bids = [], asks = [] } = response.data;

      let bestBid = Decimal(0);
      let bestAsk = Decimal(0);

      if (bids.length > 0) {
        const sortedBids = bids.sort((a: any, b: any) => parseFloat(b[0]) - parseFloat(a[0]));
        bestBid = new Decimal(sortedBids[0][0]);
      }

      if (asks.length > 0) {
        const sortedAsks = asks.sort((a: any, b: any) => parseFloat(a[0]) - parseFloat(b[0]));
        bestAsk = new Decimal(sortedAsks[0][0]);
      }

      return [bestBid, bestAsk];
    } catch (error: any) {
      throw new Error(`Failed to fetch BBO prices: ${error.message}`);
    }
  }

  /**
   * Round price to tick size
   */
  private roundPrice(price: Decimal): Decimal {
    const ticks = price.div(this.tickSize);
    const rounded = ticks.toDecimalPlaces(0, Decimal.ROUND_HALF_UP);
    return rounded.mul(this.tickSize);
  }

  /**
   * Build request headers with auth and signature
   */
  private buildHeaders(payload: string, timestamp: number): Record<string, string> {
    const signatureHeaders = this.auth.signRequest(payload, timestamp);

    return {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${this.auth.getAccessToken()}`,
      'x-session-id': this.sessionId,
      ...signatureHeaders
    };
  }

  /**
   * Get contract ID
   */
  getContractId(): string {
    return this.contractId;
  }

  /**
   * Get tick size
   */
  getTickSize(): Decimal {
    return this.tickSize;
  }
}
