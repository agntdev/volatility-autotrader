import { describe, expect, it } from "vitest";
import {
  detectBestPattern,
  detectDoubleBottom,
  detectDoubleTop,
  detectHeadAndShoulders,
  detectInverseHeadAndShoulders,
} from "../../src/lib/patterns.js";
import type { Candle } from "../../src/lib/deriv.js";

function seriesFromCloses(closes: number[]): Candle[] {
  return closes.map((c, i) => ({
    epoch: 1_700_000_000 + i * 60,
    open: c,
    high: c * 1.001,
    low: c * 0.999,
    close: c,
  }));
}

/** Synthetic head-and-shoulders: left shoulder, head, right shoulder, neckline break. */
function headAndShouldersCloses(): number[] {
  const base: number[] = [];
  // flat prelude
  for (let i = 0; i < 10; i++) base.push(100 + Math.sin(i) * 0.2);
  // left shoulder peak ~108
  base.push(102, 105, 108, 106, 103);
  // trough
  base.push(101, 100);
  // head ~115
  base.push(104, 110, 115, 111, 105);
  // trough
  base.push(101, 100);
  // right shoulder ~108
  base.push(103, 106, 108, 105, 102);
  // break neckline
  base.push(99, 98, 97, 96);
  return base;
}

function inverseHsCloses(): number[] {
  return headAndShouldersCloses().map((c) => 200 - c);
}

describe("pattern detection", () => {
  it("detects head-and-shoulders on historical-style series", () => {
    const prices = headAndShouldersCloses();
    const hit = detectHeadAndShoulders(prices);
    expect(hit).not.toBeNull();
    expect(hit!.direction).toBe("down");
    expect(hit!.confidence_score).toBeGreaterThanOrEqual(0.55);
  });

  it("detects inverse head-and-shoulders", () => {
    const hit = detectInverseHeadAndShoulders(inverseHsCloses());
    expect(hit).not.toBeNull();
    expect(hit!.direction).toBe("up");
  });

  it("detects double top", () => {
    const prices: number[] = [];
    for (let i = 0; i < 8; i++) prices.push(100);
    prices.push(100, 105, 110, 105, 100, 102, 110, 104, 98, 96);
    const hit = detectDoubleTop(prices);
    expect(hit).not.toBeNull();
    expect(hit!.direction).toBe("down");
  });

  it("detects double bottom", () => {
    const prices: number[] = [];
    for (let i = 0; i < 8; i++) prices.push(100);
    prices.push(100, 95, 90, 95, 100, 98, 90, 96, 102, 104);
    const hit = detectDoubleBottom(prices);
    expect(hit).not.toBeNull();
    expect(hit!.direction).toBe("up");
  });

  it("detectBestPattern returns highest confidence", () => {
    const candles = seriesFromCloses(headAndShouldersCloses());
    const best = detectBestPattern(candles);
    expect(best).not.toBeNull();
    expect(best!.confidence_score).toBeGreaterThan(0.5);
  });

  it("returns null on flat noise with too little structure", () => {
    const prices = Array.from({ length: 30 }, () => 100);
    expect(detectHeadAndShoulders(prices)).toBeNull();
  });
});
