/**
 * Trade execution + pattern scan orchestration.
 * Validates risk, sizes the stake, calls Deriv, records trades, builds notices.
 */

import {
  buyMultiplier,
  derivErrorMessage,
  fetchBalance,
  fetchCandles,
  sellContract,
  DerivError,
} from "./deriv.js";
import { decryptToken } from "./crypto.js";
import { now } from "./clock.js";
import {
  addTrade,
  calculateStake,
  countOpenTrades,
  getOrCreateUser,
  getOwnerSettings,
  getRisk,
  getTrade,
  listOpenTrades,
  newTradeId,
  saveTrade,
  saveUser,
  updateTradeStatus,
} from "./domain.js";
import { detectBestPattern, patternLabel, toSignal } from "./patterns.js";
import {
  instrumentLabel,
  type StrategySignal,
  type Trade,
  type User,
} from "./types.js";

export interface ScanResult {
  signals: StrategySignal[];
  trades: Trade[];
  messages: string[];
  errors: string[];
}

export async function resolveApiToken(user: User): Promise<string | undefined> {
  if (!user.encrypted_api_token) return undefined;
  try {
    return await decryptToken(user.encrypted_api_token);
  } catch {
    return undefined;
  }
}

/**
 * Scan configured instruments/timeframes for the user; optionally execute
 * when autotrade is enabled and risk allows.
 */
export async function scanAndMaybeTrade(
  telegramId: string,
  opts?: { execute?: boolean },
): Promise<ScanResult> {
  const execute = opts?.execute ?? true;
  const user = await getOrCreateUser(telegramId);
  const owner = await getOwnerSettings();
  const risk = await getRisk(telegramId);
  const result: ScanResult = { signals: [], trades: [], messages: [], errors: [] };

  const token = await resolveApiToken(user);
  if (!token) {
    result.errors.push("Link your Deriv API token first — open the menu and finish setup.");
    return result;
  }

  const instruments =
    user.instruments.length > 0 ? user.instruments : owner.instruments;
  const timeframes = user.timeframes.length > 0 ? user.timeframes : ["60", "300"];

  // Deduplicate: at most one signal per instrument per scan.
  const bestByInstrument = new Map<string, StrategySignal>();

  for (const symbol of instruments) {
    for (const tf of timeframes) {
      const granularity = Number(tf) || 60;
      try {
        const candles = await fetchCandles(token, symbol, granularity, 120);
        const hit = detectBestPattern(candles);
        if (!hit) continue;
        if (hit.confidence_score < owner.confidence_threshold) continue;
        const signal = toSignal(hit, symbol, String(granularity));
        const prev = bestByInstrument.get(symbol);
        if (!prev || signal.confidence_score > prev.confidence_score) {
          bestByInstrument.set(symbol, signal);
        }
      } catch (err) {
        result.errors.push(
          `${instrumentLabel(symbol)} (${granularity}s): ${derivErrorMessage(err)}`,
        );
      }
    }
  }

  result.signals = [...bestByInstrument.values()];

  if (!execute || !user.autotrade_enabled) {
    if (result.signals.length === 0 && result.errors.length === 0) {
      result.messages.push("No patterns above your confidence threshold right now.");
    }
    return result;
  }

  let openCount = await countOpenTrades(telegramId);

  for (const signal of result.signals) {
    if (openCount >= risk.max_concurrent_trades) {
      result.messages.push(
        `Skipped ${instrumentLabel(signal.instrument)} — max concurrent trades (${risk.max_concurrent_trades}) reached.`,
      );
      continue;
    }

    // One open trade per instrument.
    const open = await listOpenTrades(telegramId);
    if (open.some((t) => t.instrument === signal.instrument)) {
      result.messages.push(
        `Skipped ${instrumentLabel(signal.instrument)} — you already have an open trade there.`,
      );
      continue;
    }

    try {
      const bal = await fetchBalance(token);
      user.last_balance = bal.balance;
      user.last_currency = bal.currency;
      user.balance_alert_sent = false;
      await saveUser(user);

      if (bal.balance < owner.min_balance_alert) {
        result.messages.push(
          `Balance ${bal.balance} ${bal.currency} is below the minimum alert level (${owner.min_balance_alert}). Trading paused for safety.`,
        );
        break;
      }

      const sized = calculateStake(bal.balance, risk);
      if (sized.stake > bal.balance) {
        result.errors.push(
          `Insufficient balance for ${instrumentLabel(signal.instrument)} (need ${sized.stake} ${bal.currency}).`,
        );
        continue;
      }
      // Micro accounts: stake must leave a little room.
      if (bal.balance < 1) {
        result.errors.push("Balance too low to open a trade (under $1).");
        continue;
      }

      const trade: Trade = {
        id: newTradeId(),
        telegram_id: telegramId,
        instrument: signal.instrument,
        direction: signal.direction,
        stake: sized.stake,
        stop_loss: sized.stopLoss,
        take_profit: sized.takeProfit,
        entry_time: now(),
        status: "pending",
        pattern_type: signal.pattern_type,
        confidence_score: signal.confidence_score,
        timeframe: signal.timeframe,
        currency: bal.currency,
      };
      await addTrade(trade);

      try {
        const bought = await buyMultiplier(token, {
          symbol: signal.instrument,
          direction: signal.direction,
          stake: sized.stake,
          currency: bal.currency,
          stopLoss: sized.stopLoss,
          takeProfit: sized.takeProfit,
        });
        trade.status = "open";
        trade.contract_id = bought.contract_id;
        trade.stake = bought.buy_price;
        await saveTrade(trade);
        result.trades.push(trade);
        openCount++;
        result.messages.push(
          tradeOpenedText(trade),
        );
      } catch (err) {
        trade.status = "failed";
        trade.exit_time = now();
        trade.notes = err instanceof Error ? err.message : "buy failed";
        await saveTrade(trade);
        result.errors.push(
          `Trade failed on ${instrumentLabel(signal.instrument)}: ${derivErrorMessage(err)}`,
        );
      }
    } catch (err) {
      result.errors.push(derivErrorMessage(err));
      if (err instanceof DerivError && String(err.message).toLowerCase().includes("rate")) {
        break; // stop hammering during rate limits
      }
    }
  }

  if (result.signals.length === 0 && result.trades.length === 0 && result.errors.length === 0) {
    result.messages.push("No patterns above your confidence threshold right now.");
  }

  return result;
}

export function tradeOpenedText(trade: Trade): string {
  const dir = trade.direction === "up" ? "UP" : "DOWN";
  const pat = trade.pattern_type ? patternLabel(trade.pattern_type) : "signal";
  const conf =
    trade.confidence_score != null
      ? ` (${Math.round(trade.confidence_score * 100)}% confidence)`
      : "";
  return (
    `Trade opened: ${instrumentLabel(trade.instrument)} ${dir}\n` +
    `Pattern: ${pat}${conf}\n` +
    `Stake: ${fmt(trade.stake)} ${trade.currency ?? "USD"}\n` +
    `Stop-loss: ${fmt(trade.stop_loss)} · Take-profit: ${fmt(trade.take_profit)}`
  );
}

export async function closeTradeManual(
  telegramId: string,
  tradeId: string,
): Promise<{ ok: true; trade: Trade; message: string } | { ok: false; message: string }> {
  const owner = await getOwnerSettings();
  if (!owner.manual_override_enabled) {
    return { ok: false, message: "Manual overrides are disabled by the owner." };
  }
  const trade = await getTrade(tradeId);
  if (!trade || trade.telegram_id !== telegramId) {
    return { ok: false, message: "Couldn't find that trade." };
  }
  if (trade.status !== "open" && trade.status !== "pending") {
    return {
      ok: false,
      message: `That trade is already ${trade.status.replace("_", " ")}.`,
    };
  }

  const user = await getOrCreateUser(telegramId);
  const token = await resolveApiToken(user);

  if (trade.contract_id && token) {
    try {
      const sold = await sellContract(token, trade.contract_id);
      const pnl = sold.sold_for - trade.stake;
      const updated = await updateTradeStatus(tradeId, "cancelled", {
        exit_time: now(),
        pnl,
        notes: "User closed",
      });
      return {
        ok: true,
        trade: updated!,
        message:
          `Closed ${instrumentLabel(trade.instrument)}.\n` +
          `P&L: ${fmt(pnl)} ${trade.currency ?? "USD"}`,
      };
    } catch (err) {
      // Still mark cancelled locally if Deriv rejects mid-execution race.
      if (String((err as Error)?.message ?? "").toLowerCase().includes("sold")) {
        const updated = await updateTradeStatus(tradeId, "cancelled", {
          exit_time: now(),
          notes: "User closed (already sold)",
        });
        return {
          ok: true,
          trade: updated!,
          message: `Closed ${instrumentLabel(trade.instrument)} (already settled on Deriv).`,
        };
      }
      return { ok: false, message: derivErrorMessage(err) };
    }
  }

  const updated = await updateTradeStatus(tradeId, "cancelled", {
    exit_time: now(),
    pnl: 0,
    notes: "User closed (no remote contract)",
  });
  return {
    ok: true,
    trade: updated!,
    message: `Cancelled ${instrumentLabel(trade.instrument)}.`,
  };
}

/** Adjust SL/TP multipliers on an open trade (local record + note; remote amend is limited). */
export async function adjustTradeLevels(
  telegramId: string,
  tradeId: string,
  kind: "widen" | "tighten",
): Promise<{ ok: true; trade: Trade; message: string } | { ok: false; message: string }> {
  const owner = await getOwnerSettings();
  if (!owner.manual_override_enabled) {
    return { ok: false, message: "Manual overrides are disabled by the owner." };
  }
  const trade = await getTrade(tradeId);
  if (!trade || trade.telegram_id !== telegramId) {
    return { ok: false, message: "Couldn't find that trade." };
  }
  if (trade.status !== "open") {
    return { ok: false, message: "You can only adjust open trades." };
  }
  const factor = kind === "widen" ? 1.25 : 0.8;
  trade.stop_loss = Math.max(0.01, Math.round(trade.stop_loss * factor * 100) / 100);
  trade.take_profit = Math.max(0.01, Math.round(trade.take_profit * factor * 100) / 100);
  trade.notes = `Adjusted ${kind} at ${now()}`;
  await saveTrade(trade);
  return {
    ok: true,
    trade,
    message:
      `Updated levels on ${instrumentLabel(trade.instrument)}.\n` +
      `Stop-loss: ${fmt(trade.stop_loss)} · Take-profit: ${fmt(trade.take_profit)}\n` +
      `Note: remote order amend depends on Deriv contract type — levels are stored for tracking.`,
  };
}

export function fmt(n: number): string {
  return (Math.round(n * 100) / 100).toFixed(2);
}

export function historyTable(trades: Trade[]): string {
  if (trades.length === 0) {
    return "No trades yet — enable autotrading or run a scan to open one.";
  }
  const lines = trades.map((t, i) => {
    const dir = t.direction === "up" ? "↑" : "↓";
    const pnl =
      t.pnl != null ? ` P&L ${t.pnl >= 0 ? "+" : ""}${fmt(t.pnl)}` : "";
    const st = t.status.replace("_", " ");
    return `${i + 1}. ${instrumentLabel(t.instrument)} ${dir} ${fmt(t.stake)} · ${st}${pnl}`;
  });
  const closed = trades.filter((t) => t.pnl != null);
  const totalPnl = closed.reduce((s, t) => s + (t.pnl ?? 0), 0);
  const wins = closed.filter((t) => (t.pnl ?? 0) > 0).length;
  const footer =
    closed.length > 0
      ? `\n\nClosed ${closed.length} · Wins ${wins} · Net ${totalPnl >= 0 ? "+" : ""}${fmt(totalPnl)}`
      : "";
  return `Last ${trades.length} trade(s):\n\n` + lines.join("\n") + footer;
}

/** Safe DM helper — swallows 403 (blocked / never started) without aborting loops. */
export async function safeSend(
  send: (chatId: number | string, text: string, extra?: object) => Promise<unknown>,
  chatId: number | string,
  text: string,
  extra?: object,
): Promise<boolean> {
  try {
    await send(chatId, text, extra);
    return true;
  } catch (err) {
    const msg = String((err as Error)?.message ?? err);
    if (msg.includes("403") || msg.toLowerCase().includes("blocked") || msg.includes("bot was blocked")) {
      return false;
    }
    // Other errors: don't abort caller loops
    return false;
  }
}

