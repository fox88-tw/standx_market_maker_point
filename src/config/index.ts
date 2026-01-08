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
