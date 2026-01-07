import { StandXAuth } from '../src/api/standx-auth';
import { StandXClient } from '../src/api/standx-client';
import { getConfig } from '../src/config';
import { log } from '../src/utils/logger';
import Decimal from 'decimal.js';

/**
 * Test market order functionality
 * 1. Buy 0.0001 BTC at market
 * 2. Sell 0.0001 BTC at market (close position)
 */
async function main() {
  const config = getConfig();
  const testQty = new Decimal('0.0001');

  log.info('🧪 Starting Market Order Test...');
  log.info(`  Test Quantity: ${testQty} BTC`);

  // Initialize auth
  const auth = new StandXAuth(
    config.standx.privateKey,
    config.standx.address,
    config.standx.chain
  );

  await auth.login();

  // Initialize client
  const client = new StandXClient(auth);
  await client.initialize(config.trading.symbol);

  // Check current position
  log.info('\n📊 Checking current position...');
  const initialPosition = await client.getPosition(config.trading.symbol);
  log.info(`  Initial Position: ${initialPosition} BTC`);

  // Step 1: Market buy to open position
  log.info('\n📍 Step 1: Placing MARKET BUY order...');
  const buyResult = await client.placeOrder(
    config.trading.symbol,
    'buy',
    testQty,
    Decimal(0),  // Price doesn't matter for market orders
    false,       // Not reduce only
    'market'     // MARKET order type
  );

  if (!buyResult.success) {
    log.error(`❌ Market BUY failed: ${buyResult.errorMessage}`);
    return;
  }

  log.info(`✅ Market BUY order placed: ${buyResult.orderId}`);
  log.info(`  Status: ${buyResult.status}`);
  log.info(`  Expected Status: FILLED`);

  // Wait a moment for execution
  await new Promise(resolve => setTimeout(resolve, 1000));

  // Check position after buy
  log.info('\n📊 Checking position after buy...');
  const positionAfterBuy = await client.getPosition(config.trading.symbol);
  log.info(`  Position: ${positionAfterBuy} BTC`);

  // Step 2: Market sell to close position
  log.info('\n📍 Step 2: Placing MARKET SELL order (close position)...');
  const sellResult = await client.placeOrder(
    config.trading.symbol,
    'sell',
    testQty,
    Decimal(0),  // Price doesn't matter for market orders
    true,        // Reduce only - this will close the position
    'market'     // MARKET order type
  );

  if (!sellResult.success) {
    log.error(`❌ Market SELL failed: ${sellResult.errorMessage}`);
    log.warn('⚠️  Position may still be open!');
    return;
  }

  log.info(`✅ Market SELL order placed: ${sellResult.orderId}`);
  log.info(`  Status: ${sellResult.status}`);

  // Wait a moment for execution
  await new Promise(resolve => setTimeout(resolve, 1000));

  // Check final position
  log.info('\n📊 Checking final position...');
  const finalPosition = await client.getPosition(config.trading.symbol);
  log.info(`  Final Position: ${finalPosition} BTC`);

  // Test results
  log.info('\n' + '='.repeat(50));
  log.info('🧪 TEST RESULTS');
  log.info('='.repeat(50));

  const buySuccess = buyResult.success && buyResult.status === 'FILLED';
  const sellSuccess = sellResult.success && sellResult.status === 'FILLED';
  const positionClosed = finalPosition.abs().lt(new Decimal('0.00001')); // Near zero

  log.info(`Market BUY:      ${buySuccess ? '✅ PASS' : '❌ FAIL'}`);
  log.info(`Market SELL:     ${sellSuccess ? '✅ PASS' : '❌ FAIL'}`);
  log.info(`Position Closed: ${positionClosed ? '✅ PASS' : '❌ FAIL'}`);

  if (buySuccess && sellSuccess && positionClosed) {
    log.info('\n✅ All tests PASSED!');
  } else {
    log.error('\n❌ Some tests FAILED!');
    if (!positionClosed) {
      log.error(`⚠️  WARNING: Position is not zero: ${finalPosition} BTC`);
      log.error('You may need to manually close the position!');
    }
  }
}

main().catch(console.error);
