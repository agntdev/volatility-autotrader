/**
 * Domain repositories — all durable reads/writes go through explicit keys
 * and index records (never KEYS/SCAN).
 */

import { getStore, keys } from "./store.js";
import { now } from "./clock.js";
import {
  DEFAULT_OWNER,
  DEFAULT_RISK,
  DEFAULT_INSTRUMENTS,
  DEFAULT_TIMEFRAMES,
  type OwnerSettings,
  type RiskProfile,
  type Trade,
  type TradeStatus,
  type User,
} from "./types.js";

// ── User ──────────────────────────────────────────────────────────────────

export async function getUser(telegramId: string): Promise<User | undefined> {
  return getStore().get<User>(keys.user(telegramId));
}

export async function saveUser(user: User): Promise<void> {
  user.updated_at = now();
  await getStore().set(keys.user(telegramId(user)), user);
}

function telegramId(user: User): string {
  return user.telegram_id;
}

export async function getOrCreateUser(telegramId: string): Promise<User> {
  const existing = await getUser(telegramId);
  if (existing) return existing;
  const user: User = {
    telegram_id: telegramId,
    language_preference: "en",
    accepted_terms: false,
    autotrade_enabled: false,
    instruments: [...DEFAULT_INSTRUMENTS],
    timeframes: [...DEFAULT_TIMEFRAMES],
    created_at: now(),
    updated_at: now(),
  };
  await saveUser(user);
  return user;
}

// ── Risk ──────────────────────────────────────────────────────────────────

export async function getRisk(telegramId: string): Promise<RiskProfile> {
  const r = await getStore().get<RiskProfile>(keys.risk(telegramId));
  return r ?? { ...DEFAULT_RISK };
}

export async function saveRisk(telegramId: string, risk: RiskProfile): Promise<void> {
  await getStore().set(keys.risk(telegramId), risk);
}

export async function applyDefaultRisk(
  telegramId: string,
  owner?: OwnerSettings,
): Promise<RiskProfile> {
  const o = owner ?? (await getOwnerSettings());
  const risk: RiskProfile = {
    max_risk_percent: o.default_risk_percent,
    max_concurrent_trades: o.default_max_concurrent,
    tp_multiplier: o.default_tp_multiplier,
    sl_fraction: o.default_sl_fraction,
  };
  await saveRisk(telegramId, risk);
  return risk;
}

// ── Trades ────────────────────────────────────────────────────────────────

export async function getTrade(tradeId: string): Promise<Trade | undefined> {
  return getStore().get<Trade>(keys.trade(tradeId));
}

export async function saveTrade(trade: Trade): Promise<void> {
  await getStore().set(keys.trade(trade.id), trade);
}

export async function listTradeIds(telegramId: string): Promise<string[]> {
  return (await getStore().get<string[]>(keys.tradeIndex(telegramId))) ?? [];
}

export async function addTrade(trade: Trade): Promise<void> {
  await saveTrade(trade);
  const idx = await listTradeIds(trade.telegram_id);
  const next = [trade.id, ...idx.filter((id) => id !== trade.id)].slice(0, 200);
  await getStore().set(keys.tradeIndex(trade.telegram_id), next);
}

export async function listTrades(telegramId: string, limit = 10): Promise<Trade[]> {
  const ids = (await listTradeIds(telegramId)).slice(0, limit);
  const out: Trade[] = [];
  for (const id of ids) {
    const t = await getTrade(id);
    if (t) out.push(t);
  }
  return out;
}

export async function countOpenTrades(telegramId: string): Promise<number> {
  const ids = await listTradeIds(telegramId);
  let n = 0;
  for (const id of ids) {
    const t = await getTrade(id);
    if (t && (t.status === "open" || t.status === "pending")) n++;
  }
  return n;
}

export async function listOpenTrades(telegramId: string): Promise<Trade[]> {
  const ids = await listTradeIds(telegramId);
  const out: Trade[] = [];
  for (const id of ids) {
    const t = await getTrade(id);
    if (t && (t.status === "open" || t.status === "pending")) out.push(t);
  }
  return out;
}

export async function updateTradeStatus(
  tradeId: string,
  status: TradeStatus,
  patch?: Partial<Pick<Trade, "exit_time" | "pnl" | "notes">>,
): Promise<Trade | undefined> {
  const t = await getTrade(tradeId);
  if (!t) return undefined;
  t.status = status;
  if (patch?.exit_time != null) t.exit_time = patch.exit_time;
  if (patch?.pnl != null) t.pnl = patch.pnl;
  if (patch?.notes != null) t.notes = patch.notes;
  await saveTrade(t);
  return t;
}

// ── Autotrade index ───────────────────────────────────────────────────────

export async function listAutotradeUserIds(): Promise<string[]> {
  return (await getStore().get<string[]>(keys.autotradeIndex())) ?? [];
}

export async function setAutotradeEnabled(
  telegramId: string,
  enabled: boolean,
): Promise<void> {
  const user = await getOrCreateUser(telegramId);
  user.autotrade_enabled = enabled;
  await saveUser(user);
  const idx = await listAutotradeUserIds();
  const next = enabled
    ? Array.from(new Set([telegramId, ...idx]))
    : idx.filter((id) => id !== telegramId);
  await getStore().set(keys.autotradeIndex(), next);
}

// ── Owner settings ────────────────────────────────────────────────────────

export async function getOwnerSettings(): Promise<OwnerSettings> {
  const s = await getStore().get<OwnerSettings>(keys.owner());
  return s ? { ...DEFAULT_OWNER, ...s } : { ...DEFAULT_OWNER };
}

export async function saveOwnerSettings(settings: OwnerSettings): Promise<void> {
  await getStore().set(keys.owner(), settings);
}

// ── Stake sizing ──────────────────────────────────────────────────────────

/**
 * 1% fractional risk model (adjustable via max_risk_percent).
 * stake = balance * (max_risk_percent / 100)
 * stop-loss cash amount = stake * sl_fraction
 * take-profit cash amount = stop-loss * tp_multiplier
 */
export function calculateStake(
  balance: number,
  risk: RiskProfile,
): { stake: number; stopLoss: number; takeProfit: number } {
  const pct = Math.max(0.1, Math.min(10, risk.max_risk_percent));
  // Fractional risk model; for micro accounts ($1–$100) keep stake ≤ balance.
  let stake = Math.floor(balance * (pct / 100) * 100) / 100;
  const platformMin = 0.35;
  if (stake < platformMin && balance >= platformMin) {
    stake = platformMin;
  } else if (stake < 0.01) {
    stake = 0.01;
  }
  stake = Math.min(stake, Math.floor(balance * 100) / 100);
  const stopLoss = Math.floor(stake * risk.sl_fraction * 100) / 100;
  const takeProfit = Math.floor(stopLoss * risk.tp_multiplier * 100) / 100;
  return {
    stake,
    stopLoss: Math.max(0.01, stopLoss),
    takeProfit: Math.max(0.01, takeProfit),
  };
}

export function newTradeId(): string {
  const n = now().toString(36);
  const r = crypto.getRandomValues(new Uint32Array(1))[0]!.toString(36);
  return `t_${n}_${r}`;
}
