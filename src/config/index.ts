import convict from 'convict';
import dotenv from 'dotenv';
import { Config, TradingMode } from '../types';

// Load .env file
dotenv.config();

// Define configuration schema
const config = convict({
  standx: {
    privateKey: {
      doc: 'StandX wallet private key',
      format: String,
      default: '',
      env: 'STANDX_WALLET_PRIVATE_KEY'
    },
    address: {
      doc: 'StandX wallet address',
      format: String,
      default: '',
      env: 'STANDX_WALLET_ADDRESS'
    },
    chain: {
      doc: 'Blockchain network',
      format: ['bsc', 'eth'],
      default: 'bsc',
      env: 'STANDX_CHAIN'
    }
  },
  trading: {
    symbol: {
      doc: 'Trading symbol',
      format: String,
      default: 'BTC-USD',
      env: 'TRADING_SYMBOL'
    },
    mode: {
      doc: 'Trading mode (both, buy, sell)',
      format: ['both', 'buy', 'sell'],
      default: 'both',
      env: 'TRADING_MODE'
    },
    leverage: {
      doc: 'Leverage multiple applied at startup',
      format: 'int',
      default: 10,
      env: 'TRADING_LEVERAGE'
    },
    marginMode: {
      doc: 'Margin mode (cross or isolated)',
      format: ['cross', 'isolated'],
      default: 'isolated',
      env: 'TRADING_MARGIN_MODE'
    },
    orderSizeBtc: {
      doc: 'Order size in BTC',
      format: Number,
      default: 0.1,
      env: 'TRADING_ORDER_SIZE_BTC'
    },
    orderDistanceBp: {
      doc: 'Target order distance from mark price in basis points',
      format: Number,
      default: 20,
      env: 'TRADING_ORDER_DISTANCE_BP'
    },
    orderDistanceLowVolBp: {
      doc: 'Order distance in low volatility regime (bps)',
      format: Number,
      default: 10,
      env: 'TRADING_ORDER_DISTANCE_LOW_VOL_BP'
    },
    orderDistanceNormalVolBp: {
      doc: 'Order distance in normal volatility regime (bps)',
      format: Number,
      default: 15,
      env: 'TRADING_ORDER_DISTANCE_NORMAL_VOL_BP'
    },
    orderDistanceHighVolBp: {
      doc: 'Order distance in high volatility regime (bps)',
      format: Number,
      default: 25,
      env: 'TRADING_ORDER_DISTANCE_HIGH_VOL_BP'
    },
    minDistanceBp: {
      doc: 'Minimum distance in basis points (too close = risk of fill)',
      format: Number,
      default: 10,
      env: 'TRADING_MIN_DISTANCE_BP'
    },
    maxDistanceBp: {
      doc: 'Maximum distance in basis points (too far = no points)',
      format: Number,
      default: 30,
      env: 'TRADING_MAX_DISTANCE_BP'
    },
    minReplaceIntervalMs: {
      doc: 'Minimum interval between order replacements in milliseconds',
      format: Number,
      default: 1000,
      env: 'TRADING_MIN_REPLACE_INTERVAL_MS'
    },
    replaceDeadZoneBp: {
      doc: 'Dead-zone buffer in basis points for replacement decisions',
      format: Number,
      default: 2,
      env: 'TRADING_REPLACE_DEAD_ZONE_BP'
    },
    minOrderLiveMs: {
      doc: 'Minimum time for an order to stay live to earn maker points (ms)',
      format: Number,
      default: 3000,
      env: 'TRADING_MIN_ORDER_LIVE_MS'
    },
    closePositionMode: {
      doc: 'Close position mode (market or limit)',
      format: ['market', 'limit'],
      default: 'market',
      env: 'TRADING_CLOSE_POSITION_MODE'
    },
    closePositionOffsetBp: {
      doc: 'Offset in basis points for limit close orders',
      format: Number,
      default: 5,
      env: 'TRADING_CLOSE_POSITION_OFFSET_BP'
    },
    closePositionTimeoutMs: {
      doc: 'Timeout for limit close orders before falling back to market (ms)',
      format: Number,
      default: 3000,
      env: 'TRADING_CLOSE_POSITION_TIMEOUT_MS'
    }
  },
  binance: {
    baseUrl: {
      doc: 'Binance Futures REST base URL',
      format: String,
      default: 'https://fapi.binance.com',
      env: 'BINANCE_FUTURES_BASE_URL'
    },
    symbol: {
      doc: 'Binance Futures symbol for BBO monitoring',
      format: String,
      default: 'BTCUSDT',
      env: 'BINANCE_FUTURES_SYMBOL'
    }
  },
  spreadGuard: {
    enabled: {
      doc: 'Enable spread widening guard',
      format: Boolean,
      default: true,
      env: 'SPREAD_GUARD_ENABLED'
    },
    jumpSpreadBp: {
      doc: 'Spread jump threshold in basis points vs rolling baseline',
      format: Number,
      default: 5,
      env: 'SPREAD_GUARD_JUMP_BP'
    },
    maxSpreadBp: {
      doc: 'Absolute max spread in basis points',
      format: Number,
      default: 20,
      env: 'SPREAD_GUARD_MAX_BP'
    },
    basisDiffBp: {
      doc: 'Max StandX vs Binance basis difference (bp) before softening guard',
      format: Number,
      default: 15,
      env: 'SPREAD_GUARD_BASIS_DIFF_BP'
    },
    lookbackSamples: {
      doc: 'Number of recent samples for spread baseline',
      format: Number,
      default: 10,
      env: 'SPREAD_GUARD_LOOKBACK_SAMPLES'
    },
    quantileSamples: {
      doc: 'Number of samples for short-window spread quantile',
      format: Number,
      default: 60,
      env: 'SPREAD_GUARD_QUANTILE_SAMPLES'
    },
    maxQuantile: {
      doc: 'Quantile for dynamic max spread threshold (0-1)',
      format: Number,
      default: 0.95,
      env: 'SPREAD_GUARD_MAX_QUANTILE'
    },
    volLookbackSamples: {
      doc: 'Number of samples for volatility regime detection',
      format: Number,
      default: 60,
      env: 'SPREAD_GUARD_VOL_LOOKBACK_SAMPLES'
    },
    volHighThresholdBp: {
      doc: 'Volatility threshold (bp) for high-vol regime',
      format: Number,
      default: 5,
      env: 'SPREAD_GUARD_VOL_HIGH_THRESHOLD_BP'
    },
    volLowThresholdBp: {
      doc: 'Volatility threshold (bp) for low-vol regime',
      format: Number,
      default: 1,
      env: 'SPREAD_GUARD_VOL_LOW_THRESHOLD_BP'
    },
    highVolJumpMultiplier: {
      doc: 'Jump threshold multiplier in high-vol regime',
      format: Number,
      default: 1.5,
      env: 'SPREAD_GUARD_HIGH_VOL_JUMP_MULTIPLIER'
    },
    highVolMaxMultiplier: {
      doc: 'Max spread multiplier in high-vol regime',
      format: Number,
      default: 1.5,
      env: 'SPREAD_GUARD_HIGH_VOL_MAX_MULTIPLIER'
    },
    lowVolJumpMultiplier: {
      doc: 'Jump threshold multiplier in low-vol regime',
      format: Number,
      default: 0.8,
      env: 'SPREAD_GUARD_LOW_VOL_JUMP_MULTIPLIER'
    },
    lowVolMaxMultiplier: {
      doc: 'Max spread multiplier in low-vol regime',
      format: Number,
      default: 0.8,
      env: 'SPREAD_GUARD_LOW_VOL_MAX_MULTIPLIER'
    },
    pollIntervalMs: {
      doc: 'Polling interval for Binance BBO in milliseconds',
      format: Number,
      default: 1000,
      env: 'SPREAD_GUARD_POLL_INTERVAL_MS'
    },
    cooldownMs: {
      doc: 'Cooldown after canceling orders due to spread widening',
      format: Number,
      default: 5000,
      env: 'SPREAD_GUARD_COOLDOWN_MS'
    }
  },
  telegram: {
    token: {
      doc: 'Telegram bot token',
      format: String,
      default: '',
      env: 'TELEGRAM_TOKEN'
    },
    chatId: {
      doc: 'Telegram chat ID',
      format: String,
      default: '',
      env: 'TELEGRAM_CHAT_ID'
    },
    enabled: {
      doc: 'Enable Telegram notifications (must be explicitly enabled to send alerts)',
      format: Boolean,
      default: false,
      env: 'TELEGRAM_ENABLED'
    }
  },
  logging: {
    level: {
      doc: 'Log level',
      format: ['debug', 'info', 'warn', 'error'],
      default: 'info',
      env: 'LOG_LEVEL'
    },
    toFile: {
      doc: 'Log to file',
      format: Boolean,
      default: true,
      env: 'LOG_TO_FILE'
    },
    toConsole: {
      doc: 'Log to console',
      format: Boolean,
      default: true,
      env: 'LOG_TO_CONSOLE'
    }
  }
});

// Validate and load configuration
config.validate({ allowed: 'strict' });

// Export typed getter
export function getConfig(): Config {
  return config.get() as Config;
}

export default config;
