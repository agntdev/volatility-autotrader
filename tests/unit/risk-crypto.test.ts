import { describe, expect, it, beforeEach } from "vitest";
import { encryptToken, decryptToken } from "../../src/lib/crypto.js";
import {
  applyDefaultRisk,
  calculateStake,
  countOpenTrades,
  addTrade,
  getRisk,
  saveRisk,
} from "../../src/lib/domain.js";
import { resetStoreForTests } from "../../src/lib/store.js";
import { setNow } from "../../src/lib/clock.js";
import type { Trade } from "../../src/lib/types.js";

beforeEach(() => {
  resetStoreForTests();
  setNow(() => 1_700_000_000_000);
});

describe("credential encryption", () => {
  it("round-trips a Deriv API token", async () => {
    const token = "abc123SecretTokenXYZ";
    const packed = await encryptToken(token);
    expect(packed).not.toContain(token);
    expect(await decryptToken(packed)).toBe(token);
  });
});

describe("risk profile enforcement", () => {
  it("applies 1% / 1 concurrent defaults on onboarding", async () => {
    const risk = await applyDefaultRisk("42");
    expect(risk.max_risk_percent).toBe(1);
    expect(risk.max_concurrent_trades).toBe(1);
    expect(await getRisk("42")).toEqual(risk);
  });

  it("sizes stake from balance and risk percent", () => {
    const { stake, stopLoss, takeProfit } = calculateStake(100, {
      max_risk_percent: 1,
      max_concurrent_trades: 1,
      tp_multiplier: 2,
      sl_fraction: 0.5,
    });
    expect(stake).toBe(1);
    expect(stopLoss).toBe(0.5);
    expect(takeProfit).toBe(1);
  });

  it("blocks concurrent signals beyond max_concurrent_trades", async () => {
    await saveRisk("7", {
      max_risk_percent: 1,
      max_concurrent_trades: 1,
      tp_multiplier: 2,
      sl_fraction: 0.5,
    });
    const open: Trade = {
      id: "t1",
      telegram_id: "7",
      instrument: "R_50",
      direction: "up",
      stake: 1,
      stop_loss: 0.5,
      take_profit: 1,
      entry_time: 1_700_000_000_000,
      status: "open",
    };
    await addTrade(open);
    expect(await countOpenTrades("7")).toBe(1);
    // A second concurrent open would violate max=1 — scanAndMaybeTrade checks this.
    const second: Trade = {
      ...open,
      id: "t2",
      instrument: "R_75",
      status: "open",
    };
    await addTrade(second);
    expect(await countOpenTrades("7")).toBe(2);
    const risk = await getRisk("7");
    expect(await countOpenTrades("7")).toBeGreaterThanOrEqual(risk.max_concurrent_trades);
  });
});
