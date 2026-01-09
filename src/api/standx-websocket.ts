import WebSocket from 'ws';
import EventEmitter from 'eventemitter3';
import { StandXAuth } from './standx-auth';
import { WSMarkPriceData, WSOrderData, WSPositionData } from '../types';
import { log } from '../utils/logger';

const WS_LOG_WHITELIST_FIELDS = ['channel', 'symbol', 'status', 'side', 'qty', 'fillQty', 'timestamp', 'type'];

const formatWSSummary = (message: any): string => {
  const channel = message?.channel ?? message?.data?.channel ?? 'unknown';
  const symbol = message?.symbol ?? message?.data?.symbol ?? 'n/a';
  const status = message?.status ?? message?.data?.status ?? 'n/a';
  return `channel=${channel} symbol=${symbol} status=${status}`;
};

const filterWSPayload = (payload: any): Record<string, unknown> => {
  if (!payload || typeof payload !== 'object') {
    return {};
  }

  return WS_LOG_WHITELIST_FIELDS.reduce<Record<string, unknown>>((acc, key) => {
    if (key in payload) {
      acc[key] = payload[key];
    }
    return acc;
  }, {});
};

/**
 * StandX WebSocket Client
 * Handles Market Stream and Order Stream connections
 */
export class StandXWebSocket extends EventEmitter {
  private auth: StandXAuth;
  private marketWS: WebSocket | null = null;
  private orderWS: WebSocket | null = null;
  private marketUrl: string;
  private orderUrl: string;
  private reconnectAttempts: number = 0;
  private maxReconnectAttempts: number = 30;
  private reconnectDelay: number = 1000;
  private isManualClose: boolean = false;

  constructor(auth: StandXAuth) {
    super();
    this.auth = auth;
    this.marketUrl = 'wss://perps.standx.com/ws-stream/v1';
    this.orderUrl = 'wss://perps.standx.com/ws-api/v1';
  }

  /**
   * Connect to both WebSocket streams
   */
  async connect(): Promise<void> {
    if (!this.auth.isLoggedIn()) {
      await this.auth.login();
    }
    this.isManualClose = false;

    // Connect Market Stream
    await this.connectMarketStream();

    // Connect Order Response Stream
    await this.connectOrderStream();
  }

  /**
   * Connect to Market Stream
   */
  private connectMarketStream(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        this.marketWS = new WebSocket(this.marketUrl, { handshakeTimeout: 30000 });

        this.marketWS.on('open', () => {
          log.debug('[WS] Market Stream connected');
          this.reconnectAttempts = 0;

          // Don't authenticate here - will be done via subscribeUserStreams()
          resolve();
        });

        this.marketWS.on('message', (data: WebSocket.Data) => {
          try {
            const message = JSON.parse(data.toString());
            log.debug(`[WS] Market message received: ${formatWSSummary(message)}`);
            const filteredPayload = filterWSPayload(message.data ?? message);
            if (Object.keys(filteredPayload).length > 0) {
              log.debug(`[WS] Market message payload: ${JSON.stringify(filteredPayload)}`);
            }
            this.handleMarketMessage(message);
          } catch (error) {
            console.error('[WS] Failed to parse market message:', error);
          }
        });

        this.marketWS.on('error', (error) => {
          console.error('[WS] Market Stream error:', error);
        });

        this.marketWS.on('close', () => {
          log.debug('[WS] Market Stream closed');
          if (!this.isManualClose) {
            this.scheduleReconnect('market');
          }
        });

        this.marketWS.on('ping', () => {
          // Respond to ping with pong
          this.marketWS?.pong();
        });

      } catch (error) {
        reject(error);
      }
    });
  }

  /**
   * Connect to Order Response Stream
   */
  private connectOrderStream(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        this.orderWS = new WebSocket(this.orderUrl, { handshakeTimeout: 30000 });

        this.orderWS.on('open', () => {
          log.debug('[WS] Order Stream connected');
          resolve();
        });

        this.orderWS.on('message', (data: WebSocket.Data) => {
          try {
            const message = JSON.parse(data.toString());
            this.handleOrderMessage(message);
          } catch (error) {
            console.error('[WS] Failed to parse order message:', error);
          }
        });

        this.orderWS.on('error', (error) => {
          console.error('[WS] Order Stream error:', error);
        });

        this.orderWS.on('close', () => {
          log.debug('[WS] Order Stream closed');
          if (!this.isManualClose) {
            this.scheduleReconnect('order');
          }
        });

      } catch (error) {
        reject(error);
      }
    });
  }

  /**
   * Handle Market Stream messages
   */
  private handleMarketMessage(message: any): void {
    const channel = message.channel;

    // Handle price channel for mark price
    if (channel === 'price' || channel === 'ticker' || channel === 'symbol_price') {
      this.handleMarkPrice(message.data || message);
      return;
    }

    switch (channel) {
      case 'order':
        log.debug(`[WS] Order message received: ${formatWSSummary(message)}`);
        const filteredPayload = filterWSPayload(message.data ?? message);
        if (Object.keys(filteredPayload).length > 0) {
          log.debug(`[WS] Order message payload: ${JSON.stringify(filteredPayload)}`);
        }
        this.handleUserOrders(message.data);
        break;
      case 'position':
        this.handleUserPosition(message.data);
        break;
      default:
        // Ignore other channels
        log.debug(`[WS] Unknown channel: ${channel}`);
        break;
    }
  }

  /**
   * Handle Order Response Stream messages
   */
  private handleOrderMessage(message: any): void {
    // Handle order creation responses
    if (message.result) {
      this.emit('order_response', message.result);
    }
  }

  /**
   * Handle mark price updates
   */
  private handleMarkPrice(data: any): void {
    const markPriceData: WSMarkPriceData = {
      symbol: data.symbol,
      markPrice: data.mark_price || data.markPrice,
      indexPrice: data.index_price || data.indexPrice,
      timestamp: data.timestamp || Date.now()
    };

    this.emit('mark_price', markPriceData);
  }

  /**
   * Handle user order updates
   */
  private handleUserOrders(data: any): void {
    const filteredPayload = filterWSPayload(data);
    if (Object.keys(filteredPayload).length > 0) {
      log.debug(`[WS] Processing order update: ${JSON.stringify(filteredPayload)}`);
    }

    const orderData: WSOrderData = {
      orderId: data.id || data.order_id,
      clientOrderId: data.cl_ord_id || data.clientOrderId,
      symbol: data.symbol,
      status: (data.status || 'OPEN').toUpperCase(),
      side: data.side,
      qty: data.qty,
      price: data.price,
      fillQty: data.fill_qty || data.fillQty,
      avgFillPrice: data.avg_fill_price || data.avgFillPrice
    };

    log.debug(`[WS] Emitting order_update event: ${JSON.stringify({
      status: orderData.status,
      fillQty: orderData.fillQty
    })}`);

    this.emit('order_update', orderData);
  }

  /**
   * Handle user position updates
   */
  private handleUserPosition(data: any): void {
    const positionData: WSPositionData = {
      symbol: data.symbol,
      positionAmt: data.position_amt || data.qty,
      entryPrice: data.entry_price,
      unrealizedPnl: data.unrealized_pnl
    };

    this.emit('position_update', positionData);
  }

  /**
   * Subscribe to mark price channel
   */
  subscribeMarkPrice(symbols: string[]): void {
    const symbol = symbols[0];

    // Correct format from StandX docs
    this.marketWS?.send(JSON.stringify({
      subscribe: {
        channel: 'price',
        symbol: symbol
      }
    }));

    log.debug(`[WS] Subscribed to price channel for ${symbol}`);
  }

  /**
   * Subscribe to user orders channel
   */
  subscribeUserOrders(): void {
    // NOTE: This is handled by subscribeUserStreams()
    // Kept for backward compatibility
    log.debug(`[WS] subscribeUserOrders() called - will subscribe via subscribeUserStreams()`);
  }

  /**
   * Subscribe to user position channel
   */
  subscribeUserPosition(): void {
    // NOTE: This is handled by subscribeUserStreams()
    // Kept for backward compatibility
    log.debug(`[WS] subscribeUserPosition() called - will subscribe via subscribeUserStreams()`);
  }

  /**
   * Subscribe to both order and position channels
   * This should be called instead of subscribing separately
   */
  subscribeUserStreams(): void {
    this.marketWS?.send(JSON.stringify({
      auth: {
        token: this.auth.getAccessToken(),
        streams: [
          { channel: 'order' },
          { channel: 'position' }
        ]
      }
    }));
    log.debug(`[WS] Subscribed to order and position streams via re-auth`);
  }

  /**
   * Schedule reconnection with exponential backoff
   */
  private scheduleReconnect(stream: 'market' | 'order'): void {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error(`[WS] Max reconnect attempts reached for ${stream} stream`);
      this.emit('max_reconnect_reached');
      return;
    }

    const delay = Math.min(this.reconnectDelay * Math.pow(2, this.reconnectAttempts), 30000);
    this.reconnectAttempts++;

    log.debug(`[WS] Reconnecting ${stream} stream in ${delay}ms (attempt ${this.reconnectAttempts})`);
    this.emit('reconnecting', { stream, attempt: this.reconnectAttempts, delay });

    setTimeout(async () => {
      if (this.isManualClose) return;

      try {
        if (stream === 'market') {
          await this.connectMarketStream();
          // Resubscribe to channels
          this.emit('market_reconnected');
        } else {
          await this.connectOrderStream();
          this.emit('order_reconnected');
        }
      } catch (error) {
        console.error(`[WS] Failed to reconnect ${stream} stream:`, error);
        this.scheduleReconnect(stream);
      }
    }, delay);
  }

  /**
   * Disconnect from both streams
   */
  disconnect(): void {
    this.isManualClose = true;

    if (this.marketWS) {
      this.marketWS.close();
      this.marketWS = null;
    }

    if (this.orderWS) {
      this.orderWS.close();
      this.orderWS = null;
    }

    log.debug('[WS] Disconnected from all streams');
  }

  /**
   * Check if connected
   */
  isConnected(): boolean {
    return this.marketWS?.readyState === WebSocket.OPEN ||
           this.orderWS?.readyState === WebSocket.OPEN;
  }
}
