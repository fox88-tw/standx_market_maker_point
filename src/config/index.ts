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
    spreadJumpBp: {
      doc: 'Spread jump threshold in basis points to trigger cancel',
      format: Number,
      default: 15,
      env: 'TRADING_SPREAD_JUMP_BP'
    },
    maxSpreadBp: {
      doc: 'Maximum spread in basis points to trigger cancel',
      format: Number,
      default: 50,
      env: 'TRADING_MAX_SPREAD_BP'
    },
    spreadBaselineWindow: {
      doc: 'Rolling window size for spread baseline',
      format: Number,
      default: 5,
      env: 'TRADING_SPREAD_BASELINE_WINDOW'
    },
    spreadCancelCooldownMs: {
      doc: 'Cooldown in ms after spread cancel before re-placing orders',
      format: Number,
      default: 15000,
      env: 'TRADING_SPREAD_CANCEL_COOLDOWN_MS'
    },
    spreadCheckIntervalMs: {
      doc: 'Interval in ms to check Binance spread',
      format: Number,
      default: 2000,
      env: 'TRADING_SPREAD_CHECK_INTERVAL_MS'
    },
    binanceSymbol: {
      doc: 'Binance symbol for spread monitoring',
      format: String,
      default: 'BTCUSDT',
      env: 'TRADING_BINANCE_SYMBOL'
    }
  },
  binance: {
    enabled: {
      doc: 'Enable Binance BBO monitoring',
      format: Boolean,
      default: false,
      env: 'BINANCE_ENABLED'
    },
    baseUrl: {
      doc: 'Binance REST base URL',
      format: String,
      default: 'https://api.binance.com',
      env: 'BINANCE_BASE_URL'
    },
    symbol: {
      doc: 'Binance symbol for BBO monitoring (e.g. BTCUSDT)',
      format: String,
      default: 'BTCUSDT',
      env: 'BINANCE_SYMBOL'
    }
  },
  spreadGuard: {
    spreadJumpBp: {
      doc: 'Spread jump threshold in basis points versus baseline',
      format: Number,
      default: 20,
      env: 'SPREAD_JUMP_BP'
    },
    maxSpreadBp: {
      doc: 'Hard max spread threshold in basis points',
      format: Number,
      default: 50,
      env: 'MAX_SPREAD_BP'
    },
    lookbackWindowMs: {
      doc: 'Lookback window for baseline spread calculation',
      format: Number,
      default: 60000,
      env: 'SPREAD_GUARD_LOOKBACK_WINDOW_MS'
    },
    rollingSamples: {
      doc: 'Max rolling samples for baseline spread calculation',
      format: Number,
      default: 30,
      env: 'SPREAD_GUARD_ROLLING_SAMPLES'
    },
    cooldownMs: {
      doc: 'Cooldown in milliseconds after canceling orders from spread guard',
      format: Number,
      default: 15000,
      env: 'SPREAD_GUARD_COOLDOWN_MS'
    }
  },
  spreadGuard: {
    jumpSpreadBp: {
      doc: 'Spread jump threshold in basis points for triggering guard',
      format: Number,
      default: 20,
      env: 'SPREAD_GUARD_JUMP_SPREAD_BP'
    },
    maxSpreadBp: {
      doc: 'Maximum spread in basis points before triggering guard',
      format: Number,
      default: 40,
      env: 'SPREAD_GUARD_MAX_SPREAD_BP'
    },
    cooldownMs: {
      doc: 'Cooldown duration after spread guard triggers (milliseconds)',
      format: Number,
      default: 30000,
      env: 'SPREAD_GUARD_COOLDOWN_MS'
    },
    lookbackSamples: {
      doc: 'Sample size for spread guard quantile calculation',
      format: Number,
      default: 50,
      env: 'SPREAD_GUARD_LOOKBACK_SAMPLES'
    },
    maxQuantile: {
      doc: 'Quantile used to cap max spread threshold',
      format: Number,
      default: 0.95,
      env: 'SPREAD_GUARD_MAX_QUANTILE'
    },
    volLookbackSamples: {
      doc: 'Sample size for spread volatility calculation',
      format: Number,
      default: 50,
      env: 'SPREAD_GUARD_VOL_LOOKBACK_SAMPLES'
    },
    volHighThreshold: {
      doc: 'High volatility threshold in basis points (std dev)',
      format: Number,
      default: 15,
      env: 'SPREAD_GUARD_VOL_HIGH_THRESHOLD'
    },
    volLowThreshold: {
      doc: 'Low volatility threshold in basis points (std dev)',
      format: Number,
      default: 5,
      env: 'SPREAD_GUARD_VOL_LOW_THRESHOLD'
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
