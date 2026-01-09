import Decimal from 'decimal.js';

// ==================== 订单相关 ====================

export type OrderSide = 'buy' | 'sell';
export type OrderStatus = 'OPEN' | 'PARTIALLY_FILLED' | 'FILLED' | 'CANCELED' | 'FAILED';

export interface OrderInfo {
  orderId: string;
  clientOrderId: string;
  symbol: string;
  side: OrderSide;
  qty: Decimal;
  price: Decimal;
  filledQty: Decimal;
  status: OrderStatus;
  avgFillPrice?: Decimal;
}

export interface OrderResult {
  success: boolean;
  orderId?: string;
  price?: Decimal;
  size?: Decimal;
  side?: OrderSide;
  status?: OrderStatus;
  errorMessage?: string;
}

// ==================== WebSocket消息 ====================

export interface WSMarkPriceData {
  symbol: string;
  markPrice: string;
  indexPrice?: string;
  timestamp: number;
}

export interface WSOrderData {
  orderId: number;
  clientOrderId: string;
  symbol: string;
  status: OrderStatus;
  side: OrderSide;
  qty: string;
  price: string;
  fillQty: string;
  avgFillPrice: string;
}

export interface WSPositionData {
  symbol: string;
  positionAmt: string;
  entryPrice: string;
  unrealizedPnl: string;
}

// ==================== 合约信息 ====================

export interface ContractInfo {
  symbol: string;
  baseAsset: string;
  tickSize: Decimal;
  minOrderQty: Decimal;
  priceTickDecimals: number;
}

// ==================== Bot状态 ====================

export interface BotStats {
  ordersPlaced: number;
  ordersCanceled: number;
  ordersFilled: number;
  startTime: number;
  lastTradeTime?: number;
}

export interface BotState {
  isRunning: boolean;
  markPrice: Decimal;
  position: Decimal;
  buyOrder: OrderInfo | null;
  sellOrder: OrderInfo | null;
  stats: BotStats;
}

export type TradingMode = 'both' | 'buy' | 'sell';

// ==================== 配置 ====================

export interface StandXConfig {
  privateKey: string;
  address: string;
  chain: string;
}

export interface TradingConfig {
  symbol: string;
  mode: TradingMode;
  orderSizeBtc: number;
  orderDistanceBp: number;
  minDistanceBp: number;
  maxDistanceBp: number;
}

export interface TelegramConfig {
  token: string;
  chatId: string;
  enabled: boolean;
}

export interface LoggingConfig {
  level: 'debug' | 'info' | 'warn' | 'error';
  toFile: boolean;
  toConsole: boolean;
}

export interface Config {
  standx: StandXConfig;
  trading: TradingConfig;
  telegram: TelegramConfig;
  logging: LoggingConfig;
}
