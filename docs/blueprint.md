# Deriv SynthIndex AutoTrader — Bot specification

**Archetype:** custom

**Voice:** professional and concise — write every user-facing message, button label, error, and empty state in this voice.

A Telegram bot that automates trading of Deriv synthetic indices (Volatility 50+ variants) using price-action pattern recognition (head-and-shoulders and supporting patterns). Implements risk management with 1% fractional position sizing, stop-loss/take-profit controls, and manual overrides for small accounts ($1–$100).

> This is the complete contract for the bot. Implement EVERY entry point, flow, feature, integration, and edge case below. The completeness review checks the bot against this document after each build pass.

## Primary audience

- Retail synthetic index traders
- Risk-conscious micro-account traders

## Success criteria

- Trades execute with 99.9% reliability during market hours
- Users can configure risk profiles without errors
- Real-time notifications delivered for all trade events

## Entry points

Every feature must be reachable from the bot's command/button surface (button-first; only /start and /help are slash commands).

- **/start** (command, actor: user, command: /start) — Initiate onboarding flow with terms and risk disclaimer
- **/help** (command, actor: user, command: /help) — Display quick-reference guide to bot controls
- **Start AutoTrading** (button, actor: user, callback: autotrade:enable) — Activate pattern monitoring and automated trading
  - inputs: instruments, timeframes
  - outputs: trade confirmation
- **Pause AutoTrading** (button, actor: user, callback: autotrade:disable) — Suspend automated trading while retaining current positions
- **/balance** (command, actor: user, command: /balance) — Display current account balance and risk parameters
  - inputs: encrypted API token
  - outputs: account balance, max risk per trade
- **/history** (command, actor: user, command: /history) — Show last 10 executed trades with performance metrics
  - inputs: user ID
  - outputs: trade history table
- **Adjust Risk Settings** (button, actor: user, callback: risk:configure) — Modify max risk per trade or concurrent positions
  - inputs: max_risk_percent, max_concurrent_trades
  - outputs: updated risk profile confirmation

## Flows

### onboarding_flow
_Trigger:_ /start

1. Display terms and risk disclaimer
2. Request Deriv account linkage via secure flow
3. Apply default risk profile (1% risk, 1 concurrent trade)

_Data touched:_ User, RiskProfile

### trade_execution_flow
_Trigger:_ pattern detected

1. Validate risk profile constraints
2. Calculate stake size from balance and stop-loss
3. Execute trade via Deriv API
4. Send Telegram confirmation with close/adjust buttons

_Data touched:_ StrategySignal, Trade

### manual_override_flow
_Trigger:_ inline button press

1. Verify trade status
2. Cancel or adjust trade parameters
3. Update trade status in history

_Data touched:_ Trade

## Data entities

Durable data (must survive a restart) uses the toolkit's persistent store, never in-memory maps.

- **User** _(retention: persistent)_ — Telegram user linked to Deriv account
  - fields: telegram_id, encrypted_api_token, language_preference
- **StrategySignal** _(retention: session)_ — Detected price pattern with confidence metrics
  - fields: instrument, pattern_type, confidence_score, timeframe, detection_timestamp
- **Trade** _(retention: persistent)_ — Active and historical trade records
  - fields: instrument, direction, stake, stop_loss, take_profit, entry_time, status, exit_time, pnl
- **RiskProfile** _(retention: persistent)_ — User-specific risk management parameters
  - fields: max_risk_percent, max_concurrent_trades, tp_multiplier

## Integrations

- **Telegram** (required) — User interface and notifications
- **Deriv API** (required) — Automated trade execution and account access
Call external APIs against their real contract (correct endpoints, ids, params); credentials from env. Do not fake responses.

## Owner controls

- Configure supported instruments (V50/V75 default)
- Set pattern confidence threshold
- Adjust position sizing rules
- Modify stop-loss/take-profit defaults
- Enable/disable manual override permissions

## Notifications

- Trade opened confirmation
- Stop-loss/take-profit execution alerts
- Error notifications for failed trades
- Daily performance summary (optional)
- Account balance alerts below minimum risk threshold

## Permissions & privacy

- Encrypted storage of API credentials
- User must explicitly accept risk disclaimer
- No third-party data sharing
- All trade decisions require user-initiated activation

## Edge cases

- Insufficient balance to execute trade
- API rate limiting during high volatility
- Multiple pattern signals on same instrument
- User-initiated close during trade execution

## Required tests

- End-to-end onboarding flow with credential encryption
- Pattern detection accuracy against historical data
- Risk profile enforcement during concurrent signals
- Notification latency under simulated market stress

## Assumptions

- Head-and-shoulders pattern detection logic is implemented as described
- Deriv API supports required trade parameters (1% fractional risk model)
- Market volatility doesn't invalidate pattern logic within 1m/5m timeframes
