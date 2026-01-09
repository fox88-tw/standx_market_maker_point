import axios, { AxiosInstance } from 'axios';

export interface BinanceBookTicker {
  symbol: string;
  bidPrice: string;
  bidQty: string;
  askPrice: string;
  askQty: string;
}

/**
 * Binance REST API Client
 */
export class BinanceClient {
  private baseUrl: string;
  private client: AxiosInstance;

  constructor(baseUrl: string = 'https://fapi.binance.com') {
    this.baseUrl = baseUrl;
    this.client = axios.create({
      baseURL: this.baseUrl,
      timeout: 5000
    });
  }

  async getBookTicker(symbol: string): Promise<BinanceBookTicker> {
    const response = await this.client.get<BinanceBookTicker>('/fapi/v1/ticker/bookTicker', {
      params: { symbol }
    });

    return response.data;
  }
}
