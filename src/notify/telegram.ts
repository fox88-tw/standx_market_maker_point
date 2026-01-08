import TelegramBot from 'node-telegram-bot-api';
import { getConfig } from '../config';
import { log } from '../utils/logger';

/**
 * Telegram Notification Service
 */
export class TelegramNotifier {
  private bot: TelegramBot | null = null;
  private chatId: string;
  private enabled: boolean;

  constructor() {
    const config = getConfig();
    this.chatId = config.telegram.chatId;
    this.enabled = config.telegram.enabled;

    if (this.enabled && (!config.telegram.token || !this.chatId)) {
      log.warn('Telegram notifications enabled but missing token or chat ID; disabling notifications');
      this.enabled = false;
      return;
    }

    if (this.enabled && config.telegram.token) {
      try {
        this.bot = new TelegramBot(config.telegram.token, { polling: false });
        log.info('Telegram bot initialized');
      } catch (error) {
        log.error(`Failed to initialize Telegram bot: ${error}`);
        this.enabled = false;
      }
    }
  }

  /**
   * Send info message
   */
  async info(message: string): Promise<void> {
    await this.send(`ℹ️ ${message}`);
  }

  /**
   * Send warning message
   */
  async warning(message: string): Promise<void> {
    await this.send(`⚠️ ${message}`);
  }

  /**
   * Send error message
   */
  async error(message: string): Promise<void> {
    await this.send(`🚨 ${message}`);
  }

  /**
   * Send trade notification
   */
  async trade(side: string, qty: string, price: string, pnl?: string): Promise<void> {
    const pnlText = pnl ? `\nP&L: ${pnl}` : '';
    const message = `
<b>🤖 StandX Maker Bot</b>
⚠️ Order Filled
Side: ${side.toUpperCase()}
Qty: ${qty} BTC
Price: $${price}${pnlText}
    `.trim();

    await this.send(message, { parse_mode: 'HTML' });
  }

  /**
   * Send bot status
   */
  async status(isRunning: boolean, uptime: string, stats: any): Promise<void> {
    const statusEmoji = isRunning ? '✅' : '⏸️';
    const message = `
<b>🤖 StandX Maker Bot Status</b>

${statusEmoji} Status: ${isRunning ? 'RUNNING' : 'STOPPED'}
⏱️ Uptime: ${uptime}
📊 Orders Placed: ${stats.ordersPlaced}
📊 Orders Canceled: ${stats.ordersCanceled}
📊 Orders Filled: ${stats.ordersFilled}
    `.trim();

    await this.send(message, { parse_mode: 'HTML' });
  }

  /**
   * Send startup notification
   */
  async startup(): Promise<void> {
    const config = getConfig();
    const message = `
<b>🚀 StandX Maker Bot Started</b>

Symbol: ${config.trading.symbol}
Mode: ${config.trading.mode}
Order Size: ${config.trading.orderSizeBtc} BTC
Distance: ${config.trading.orderDistanceBp} bp
    `.trim();

    await this.send(message, { parse_mode: 'HTML' });
  }

  /**
   * Send shutdown notification
   */
  async shutdown(): Promise<void> {
    await this.send('🛑 StandX Maker Bot Stopped');
  }

  /**
   * Send message with options
   */
  private async send(message: string, options?: any): Promise<void> {
    if (!this.enabled || !this.bot || !this.chatId) {
      return;
    }

    try {
      await this.bot.sendMessage(this.chatId, message, options);
      log.debug('Telegram message sent');
    } catch (error: any) {
      log.error(`Failed to send Telegram message: ${error.message}`);
    }
  }

  /**
   * Check if enabled
   */
  isEnabled(): boolean {
    return this.enabled && this.bot !== null;
  }
}

// Export singleton instance
export const telegram = new TelegramNotifier();
