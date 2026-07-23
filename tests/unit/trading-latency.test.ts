import { describe, expect, it, beforeEach } from "vitest";
import { resetStoreForTests } from "../../src/lib/store.js";
import { setNow, now } from "../../src/lib/clock.js";
import { calculateStake } from "../../src/lib/domain.js";
import { detectBestPattern } from "../../src/lib/patterns.js";
import type { Candle } from "../../src/lib/deriv.js";

beforeEach(() => {
  resetStoreForTests();
  setNow(() => 1_700_000_000_000);
});

describe("notification / scan latency under stress", () => {
  it("pattern detection on 120 candles finishes under 50ms", () => {
    const candles: Candle[] = Array.from({ length: 120 }, (_, i) => {
      const wave = Math.sin(i / 5) * 3 + Math.cos(i / 11) * 2;
      const c = 100 + wave + (i > 80 ? -i * 0.05 : i * 0.02);
      return { epoch: 1_700_000_000 + i * 60, open: c, high: c + 0.5, low: c - 0.5, close: c };
    });
    const t0 = performance.now();
    for (let i = 0; i < 50; i++) detectBestPattern(candles);
    const elapsed = performance.now() - t0;
    // 50 full scans on 120 candles should stay well under a Telegram notice window.
    expect(elapsed).toBeLessThan(500);
  });

  it("stake math is stable for micro accounts", () => {
    const r = { max_risk_percent: 1, max_concurrent_trades: 1, tp_multiplier: 2, sl_fraction: 0.5 };
    expect(calculateStake(1, r).stake).toBeLessThanOrEqual(1);
    expect(calculateStake(50, r).stake).toBe(0.5);
    expect(calculateStake(100, r).stake).toBe(1);
    expect(now()).toBe(1_700_000_000_000);
  });
});
