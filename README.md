# StandX Maker Points Farming Bot

一个用于在StandX上farm Maker Points的自动化bot，通过挂限价单赚取积分，完全不允许持仓。

## 功能特性

- ✅ 自动挂限价单赚取Maker Points
- ✅ WebSocket实时价格监控
- ✅ **双阈值智能订单管理**（自动保持在积分范围内）
- ✅ 订单成交立即市价平仓
- ✅ 支持双侧/单侧挂单模式
- ✅ Binance永续期货BBO价差突扩风控（立即取消挂单）
- ✅ Telegram实时通知
- ✅ 自动重连和错误恢复

## 核心策略

### 双阈值订单管理

Bot使用**双阈值机制**确保订单始终在最佳范围内获取积分：

```
价格太近 (风险区域) ←→ 理想范围 (积分区域) ←→ 价格太远 (无积分)
    ↓                    ↓                      ↓
  < minBp          [minBp ~ maxBp]          > maxBp
  取消重挂            保持订单               取消重挂
```

### BP计算方式

**BP（基点）是相对距离**，计算公式：

```javascript
BP = |markPrice - orderPrice| / orderPrice × 10000
```

**示例**：
```
Mark Price: $93,580
Sell Order:  $93,691

价格差 = |93580 - 93691| = $111
BP = 111 / 93691 × 10000 = 11.85 bp
```

### 实时监控机制

每次WebSocket收到新的mark price时，bot会：

1. **计算当前距离**：`|markPrice - orderPrice| / orderPrice × 10000`
2. **检查阈值**：
   - 如果 `distance < minDistanceBp` → 太危险，可能成交 → 取消并重挂
   - 如果 `distance > maxDistanceBp` → 太远了，吃不到积分 → 取消并重挂
   - 如果 `minDistanceBp ≤ distance ≤ maxDistanceBp` → ✅ 理想范围，保持订单
3. **动态调整**：新订单使用当前mark price重新计算价格

### 价格变化响应

当mark price变化时，bot会**自动**响应：

**场景1：Mark价格上涨（接近订单）**
```
初始: Mark $93,580, Order $93,691 → 距离 11.85 bp ✅
涨到: Mark $93,680, Order $93,691 → 距离 1.17 bp ⚠️
→ 触发: "Too close to mark price" → 自动取消并重挂
```

**场景2：Mark价格下跌（远离订单）**
```
初始: Mark $93,580, Order $93,691 → 距离 11.85 bp ✅
跌到: Mark $93,500, Order $93,691 → 距离 20.38 bp ⚠️
→ 触发: "Too far from mark price" → 自动取消并重挂
```

## 安装

```bash
npm install
```

## 配置

### 1. 创建配置文件

复制 `.env.example` 到 `.env` 并填写配置：

```bash
cp .env.example .env
```

### 2. 配置参数说明

#### StandX钱包配置

```bash
STANDX_WALLET_PRIVATE_KEY=your_private_key    # 钱包私钥
STANDX_WALLET_ADDRESS=your_wallet_address    # 钱包地址
STANDX_CHAIN=bsc                             # 链（bsc或eth）
```

#### 交易参数

```bash
TRADING_SYMBOL=BTC-USD                       # 交易对
TRADING_MODE=buy                             # 模式: buy/sell/both
TRADING_ORDER_SIZE_BTC=0.0001                # 订单大小（BTC）
TRADING_ORDER_DISTANCE_BP=10                 # 目标距离（bp）
TRADING_MIN_DISTANCE_BP=5                    # 最小距离（bp）
TRADING_MAX_DISTANCE_BP=15                   # 最大距离（bp）
TRADING_MIN_REPLACE_INTERVAL_MS=1000         # 替换最小间隔（ms）
TRADING_REPLACE_DEAD_ZONE_BP=2               # 替换缓冲带（bp）
```

#### Binance永续期货BBO配置

```bash
BINANCE_FUTURES_BASE_URL=https://fapi.binance.com  # Binance合约REST
BINANCE_FUTURES_SYMBOL=BTCUSDT                     # Binance合约交易对
```

#### 价差突扩风控（Spread Guard）

```bash
SPREAD_GUARD_ENABLED=true                    # 是否启用
SPREAD_GUARD_JUMP_BP=5                       # 相对滚动基准的突扩阈值（bp）
SPREAD_GUARD_MAX_BP=20                       # 绝对价差上限（bp）
SPREAD_GUARD_LOOKBACK_SAMPLES=10             # 滚动样本数
SPREAD_GUARD_QUANTILE_SAMPLES=60             # 短窗分位数样本数
SPREAD_GUARD_MAX_QUANTILE=0.95               # 分位数阈值（0-1）
SPREAD_GUARD_VOL_LOOKBACK_SAMPLES=60         # regime 波动样本数
SPREAD_GUARD_VOL_HIGH_THRESHOLD_BP=5         # 高波动阈值（bp）
SPREAD_GUARD_VOL_LOW_THRESHOLD_BP=1          # 低波动阈值（bp）
SPREAD_GUARD_HIGH_VOL_JUMP_MULTIPLIER=1.5    # 高波动 jump 阈值乘数
SPREAD_GUARD_HIGH_VOL_MAX_MULTIPLIER=1.5     # 高波动 max 阈值乘数
SPREAD_GUARD_LOW_VOL_JUMP_MULTIPLIER=0.8     # 低波动 jump 阈值乘数
SPREAD_GUARD_LOW_VOL_MAX_MULTIPLIER=0.8      # 低波动 max 阈值乘数
SPREAD_GUARD_POLL_INTERVAL_MS=1000           # 轮询间隔（ms）
SPREAD_GUARD_COOLDOWN_MS=5000                # 触发撤单后的冷却时间（ms）
```

#### 无历史数据时的安全起手式（1+3方案）

当没有历史数据时，建议用更稳健的即时代理作为起步，结合「短窗分位数 + 波动分区自适应」：

- **方案1：短窗分位数做即时门槛**  
  用最近 N 笔（例如 30~60）spread 计算 90~95% 分位数作为 `maxSpreadBp`，对极端值更鲁棒。
- **方案3：分时段/分波动 regime 动态调整**  
  即时波动升高时放宽 `jumpSpreadBp`/`maxSpreadBp`；流动性恢复后逐步收敛到常态阈值。

此作法比「均值×倍数」更稳健，但在**流动性偏低的时段**仍可能误触发撤单。

**参数详解**：

- **TRADING_MODE**: 交易模式
  - `buy`: 只挂买单（安全，避免做多风险）
  - `sell`: 只挂卖单（安全，避免做空风险）
  - `both`: 双边挂单（买单+卖单，积分更多但风险更高）

- **TRADING_ORDER_DISTANCE_BP**: 目标距离
  - 订单距离mark price的理想距离（bp）
  - 例如：10bp表示订单价格 = mark price × (1 ± 0.001)

- **TRADING_MIN_DISTANCE_BP**: 最小距离（危险阈值）
  - 价格太近有成交风险
  - 建议设置为目标距离的50%
  - 例如：目标10bp，最小5bp

- **TRADING_MAX_DISTANCE_BP**: 最大距离（积分阈值）
  - 价格太远可能吃不到积分
  - 建议设置为目标距离的150%
  - 例如：目标10bp，最大15bp

- **TRADING_MIN_REPLACE_INTERVAL_MS**: 替换最小间隔（ms）
  - 两次撤单重挂之间的最短时间
  - 建议设置为 500~2000ms 视流动性调整

- **TRADING_REPLACE_DEAD_ZONE_BP**: 替换缓冲带（bp）
  - 在 min/max 阈值外再加缓冲带，避免抖动重挂
  - 例如：min=5bp, max=15bp, dead-zone=2bp
    - 触发过近 < 3bp 或过远 > 17bp 才重挂

#### Telegram通知（可选）

```bash
TELEGRAM_TOKEN=your_bot_token
TELEGRAM_CHAT_ID=your_chat_id
TELEGRAM_ENABLED=false                        # 默认关闭，需手动设为true启用
```

#### 日志配置

```bash
LOG_LEVEL=info                                # debug/info/warn/error
LOG_TO_FILE=false                             # 是否写入日志文件
LOG_TO_CONSOLE=true                           # 是否输出到控制台
```

## 运行

### 开发模式

```bash
npm run dev
```

### 生产模式

```bash
npm run build
npm start
```

## 实用脚本

### 取消所有订单

```bash
npx tsx scripts/cancel-all-orders.ts
```

## 运行示例

```
╔════════════════════════════════════════╗
║   StandX Maker Points Farming Bot      ║
╚════════════════════════════════════════╝

Configuration:
  Symbol: BTC-USD
  Mode: sell
  Order Size: 0.0001 BTC
  Target Distance: 10 bp
  Valid Range: 5-15 bp

🚀 Starting StandX Maker Points Bot...
✅ Initialized for BTC-USD
✅ WebSocket connected
✅ Initial mark price: $93597.92
✅ sell order placed: bot-7d5f8c4d3ce543dc @ $93691.5

Bot is running. Press Ctrl+C to stop.

══════════════════════════════════════════════════
📊 Status Update (0h 5m)
  Mark Price: $93580.36
  Position: 0.0000 BTC
  Sell Order: Yes @ $93691.50 (distance: 11.86 bp)
  Placed: 3 | Canceled: 2 | Filled: 0
══════════════════════════════════════════════════
```

## 日志说明

### 订单替换日志

```
[SELL] Too close to mark price (4.50 bp < 5 bp), canceling and replacing...
[SELL] Too far from mark price (16.20 bp > 15 bp), canceling and replacing...
[SELL] Order in valid range: 11.86 bp [5-15 bp]
```

### 成交日志

```
⚠️⚠️⚠️ ORDER FILLED ⚠️⚠️⚠️
  Side: SELL
  Qty: 0.0001 BTC
  Price: $93691.50
🔄 Closing position immediately...
✅ Position closed successfully
🔄 Replacing SELL order...
```

## 风险提示

⚠️ **重要风险提示**：

1. **价格剧烈波动**：在极端市场条件下，价格可能快速穿过阈值范围导致成交
2. **网络延迟**：WebSocket连接不稳定可能导致价格更新延迟
3. **API限流**：频繁下单可能触发交易所限流
4. **滑点风险**：平仓时可能存在滑点
5. **合约风险**：永续合约交易存在资金费率和爆仓风险

建议：
- 使用较小的订单大小（如0.0001 BTC）
- 在市场稳定时运行
- 定期检查bot运行状态
- 设置Telegram通知及时发现问题

## 技术架构

```
┌─────────────────────────────────────────┐
│         StandX WebSocket               │
│  - Market Stream (价格更新)             │
│  - Order Stream (订单状态)              │
│  - Position Stream (持仓更新)           │
└──────────────┬──────────────────────────┘
               │
┌──────────────▼──────────────────────────┐
│        MakerPointsBot                   │
│  - 实时监控mark price                   │
│  - 双阈值订单管理                        │
│  - 自动成交处理                          │
│  - 幣安價差偵測迴避交易                  │
└──────────────┬──────────────────────────┘
               │
┌──────────────▼──────────────────────────┐
│         StandXClient (REST API)         │
│  - 下单                                 │
│  - 取消订单                              │
│  - 查询订单                              │
└─────────────────────────────────────────┘
               ▲
               │
┌──────────────┴──────────────────────────┐
│           Spread Guard Module           │
│  - 幣安價差偵測                          │
│  - 避免極端價差成交                      │
│  - 觸發撤單保護                          │
└──────────────┬──────────────────────────┘
               ▲
               │
┌──────────────┴──────────────────────────┐
│      Binance Futures BBO (REST API)     │
│  - 价差监控                              │
│  - 即时价差数据                          │
└─────────────────────────────────────────┘
```

## 故障排除

### Bot无法启动

1. 检查私钥和地址是否正确
2. 确认网络连接正常
3. 查看日志中的错误信息

### 订单无法成交

这是**正常现象**！bot的目的就是避免成交，只赚取挂单积分。如果订单成交，bot会立即平仓。

### WebSocket断开

Bot会自动重连。如果频繁断开，检查网络连接和交易所状态。

## 免责声明

本软件仅供学习研究使用，使用本软件产生的任何损失由用户自行承担。加密货币交易存在高风险，请谨慎参与。

## Sources

- [StandX Perps WebSocket API](https://docs.standx.com/standx-api/perps-ws)
- [StandX Mainnet Campaigns](https://docs.standx.com/docs/stand-x-campaigns/mainnet-campaigns)
- [StandX Market Making Program](https://docs.standx.com/docs/stand-x-campaigns/stand-x-market-making-program)
