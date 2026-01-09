import { ed25519 } from '@noble/curves/ed25519';
import { base58 } from '@scure/base';
import { ethers } from 'ethers';
import { SignJWT, jwtVerify } from 'jose';
import axios from 'axios';

/**
 * StandX Authentication Helper
 * Handles Ed25519 key generation, JWT signing, and request signing
 */
export class StandXAuth {
  private privateKey: string;
  private address: string;
  private chain: string;
  private apiUrl: string;

  private ed25519PrivateKey: Uint8Array;
  private ed25519PublicKey: Uint8Array;
  private requestId: string;
  private accessToken: string | null = null;
  private tokenExpiresAt: number | null = null;
  private tokenExpiryBufferMs: number = 60000;

  constructor(privateKey: string, address: string, chain: string = 'bsc') {
    this.privateKey = privateKey;
    this.address = address;
    this.chain = chain;
    this.apiUrl = 'https://api.standx.com';

    // Generate ephemeral Ed25519 key pair
    this.ed25519PrivateKey = ed25519.utils.randomPrivateKey();
    this.ed25519PublicKey = ed25519.getPublicKey(this.ed25519PrivateKey);

    // Encode public key as Base58 for request ID
    this.requestId = base58.encode(this.ed25519PublicKey);
  }

  /**
   * Perform login flow to get JWT token
   */
  async login(): Promise<string> {
    try {
      // Step 1: Prepare signin
      const prepareResponse = await axios.post(
        `${this.apiUrl}/v1/offchain/prepare-signin?chain=${this.chain}`,
        {
          address: this.address,
          requestId: this.requestId
        }
      );

      if (!prepareResponse.data.success) {
        throw new Error(`Prepare signin failed: ${JSON.stringify(prepareResponse.data)}`);
      }

      const signedData = prepareResponse.data.signedData;

      // Step 2: Parse JWT and extract message
      const jwtParts = signedData.split('.');
      const jwtPayload = JSON.parse(
        Buffer.from(jwtParts[1], 'base64url').toString('utf-8')
      );
      const messageToSign = jwtPayload.message;

      // Step 3: Sign with Ethereum private key
      const wallet = new ethers.Wallet(this.privateKey);
      const signature = await wallet.signMessage(messageToSign);

      // Step 4: Login
      const loginResponse = await axios.post(
        `${this.apiUrl}/v1/offchain/login?chain=${this.chain}`,
        {
          signature,
          signedData,
          expiresSeconds: 604800 // 7 days
        }
      );

      this.accessToken = loginResponse.data.token;
      if (!this.accessToken) {
        throw new Error('No token in login response');
      }
      this.tokenExpiresAt = this.getTokenExpiry(this.accessToken, 604800);

      return this.accessToken;
    } catch (error: any) {
      throw new Error(`Login failed: ${error.message}`);
    }
  }

  /**
   * Sign request payload with Ed25519
   */
  signRequest(payload: string, timestamp: number): Record<string, string> {
    const version = 'v1';
    const message = `${version},${this.requestId},${timestamp},${payload}`;
    const messageBytes = new TextEncoder().encode(message);

    const signature = ed25519.sign(messageBytes, this.ed25519PrivateKey);
    const signatureB64 = Buffer.from(signature).toString('base64');

    return {
      'x-request-sign-version': version,
      'x-request-id': this.requestId,
      'x-request-timestamp': timestamp.toString(),
      'x-request-signature': signatureB64
    };
  }

  /**
   * Get current access token
   */
  getAccessToken(): string {
    if (!this.accessToken) {
      throw new Error('Not logged in. Call login() first.');
    }
    return this.accessToken;
  }

  /**
   * Check if access token is available
   */
  isLoggedIn(): boolean {
    if (!this.accessToken) {
      return false;
    }

    if (!this.tokenExpiresAt) {
      return true;
    }

    return Date.now() < this.tokenExpiresAt - this.tokenExpiryBufferMs;
  }

  /**
   * Get request ID
   */
  getRequestId(): string {
    return this.requestId;
  }

  private getTokenExpiry(token: string, fallbackExpiresSeconds: number): number {
    const tokenParts = token.split('.');
    if (tokenParts.length < 2) {
      return Date.now() + fallbackExpiresSeconds * 1000;
    }

    try {
      const payload = JSON.parse(
        Buffer.from(tokenParts[1], 'base64url').toString('utf-8')
      );
      if (typeof payload.exp === 'number') {
        return payload.exp * 1000;
      }
    } catch (error) {
      // Fall back to configured expiry below.
    }

    return Date.now() + fallbackExpiresSeconds * 1000;
  }
}
