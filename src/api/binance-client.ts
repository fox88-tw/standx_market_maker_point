import axios, { AxiosInstance } from 'axios';
import Decimal from 'decimal.js';

export interface BinanceBbo {
  bestBid: Decimal;
  bestAsk: Decimal;
}

export class BinanceClient {
  private client: AxiosInstance;
  private baseUrl: string;

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl;
    this.client = axios.create({
      baseURL: this.baseUrl,
      timeout: 5000
    });
  }

  async fetchBbo(symbol: string): Promise<BinanceBbo> {
    const response = await this.client.get('/fapi/v1/ticker/bookTicker', {
      params: { symbol }
    });

    const bestBid = new Decimal(response.data.bidPrice || 0);
    const bestAsk = new Decimal(response.data.askPrice || 0);

    return { bestBid, bestAsk };
  }
}
