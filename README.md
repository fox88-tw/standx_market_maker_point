# StandX Maker Points Farming Bot

一个用于在StandX上farm Maker Points的自动化bot，通过挂限价单赚取积分，完全不允许持仓。

## 功能特性

- ✅ 自动挂限价单赚取Maker Points
- ✅ WebSocket实时价格监控
- ✅ **双阈值智能订单管理**（自动保持在积分范围内）
- ✅ 订单成交立即市价平仓
- ✅ 支持双侧/单侧挂单模式
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

### 核心机制与风险防护

- **双阈值（min/max bp）是策略核心**：用来把挂单维持在最佳积分区间，确保持续获取Maker Points。
- **幣安价差监控是风险迴避工具**：用于市场异常时触发暂停/撤单，避免不必要成交。
- 建议将 **Binance spread guard** 视为**防护网**而非主策略，用于异常行情时的临时保护。

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
```

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
└──────────────┬──────────────────────────┘
               │
┌──────────────▼──────────────────────────┐
│         StandXClient (REST API)         │
│  - 下单                                 │
│  - 取消订单                              │
│  - 查询订单                              │
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
