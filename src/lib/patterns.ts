/**
 * Price-action pattern recognition for synthetic indices.
 * Detects head-and-shoulders (+ inverse) and double top/bottom on OHLC series.
 */

import type { PatternType, StrategySignal, TradeDirection } from "./types.js";
import type { Candle } from "./deriv.js";
import { now } from "./clock.js";

export interface PatternHit {
  pattern_type: PatternType;
  confidence_score: number;
  direction: TradeDirection;
  /** Index in the candle array where the pattern completes. */
  at: number;
}

function closes(candles: Candle[]): number[] {
  return candles.map((c) => c.close);
}

/** Local extrema via simple swing detection (window radius r). */
function swingHighs(prices: number[], r = 2): number[] {
  const idx: number[] = [];
  for (let i = r; i < prices.length - r; i++) {
    let isHigh = true;
    for (let j = i - r; j <= i + r; j++) {
      if (j === i) continue;
      if (prices[j]! >= prices[i]!) {
        isHigh = false;
        break;
      }
    }
    if (isHigh) idx.push(i);
  }
  return idx;
}

function swingLows(prices: number[], r = 2): number[] {
  const idx: number[] = [];
  for (let i = r; i < prices.length - r; i++) {
    let isLow = true;
    for (let j = i - r; j <= i + r; j++) {
      if (j === i) continue;
      if (prices[j]! <= prices[i]!) {
        isLow = false;
        break;
      }
    }
    if (isLow) idx.push(i);
  }
  return idx;
}

function near(a: number, b: number, tol: number): boolean {
  const scale = Math.max(Math.abs(a), Math.abs(b), 1e-9);
  return Math.abs(a - b) / scale <= tol;
}

/**
 * Head-and-shoulders: three peaks, middle highest; neckline from the two troughs.
 * Bearish → direction "down".
 */
export function detectHeadAndShoulders(prices: number[]): PatternHit | null {
  const highs = swingHighs(prices);
  const lows = swingLows(prices);
  if (highs.length < 3 || lows.length < 2) return null;

  // Use the last three swing highs as L-shoulder, head, R-shoulder.
  for (let h = highs.length - 1; h >= 2; h--) {
    const ls = highs[h - 2]!;
    const head = highs[h - 1]!;
    const rs = highs[h]!;
    const pLS = prices[ls]!;
    const pHead = prices[head]!;
    const pRS = prices[rs]!;
    if (!(pHead > pLS && pHead > pRS)) continue;
    if (!near(pLS, pRS, 0.03)) continue; // shoulders roughly equal

    // Neckline troughs between shoulders and head.
    const troughs = lows.filter((i) => i > ls && i < rs);
    if (troughs.length < 2) continue;
    const n1 = prices[troughs[0]!]!;
    const n2 = prices[troughs[troughs.length - 1]!]!;
    const neck = (n1 + n2) / 2;

    // Prefer confirmation: last price at/under neckline.
    const last = prices[prices.length - 1]!;
    const headHeight = pHead - neck;
    if (headHeight <= 0) continue;
    const broken = last <= neck * 1.002;
    const shoulderSym = 1 - Math.abs(pLS - pRS) / pHead;
    const depth = Math.min(1, (pHead - last) / headHeight);
    let confidence = 0.45 + 0.3 * shoulderSym + 0.15 * Math.min(1, depth);
    if (broken) confidence += 0.15;
    confidence = Math.min(0.98, confidence);

    if (confidence < 0.55) continue;
    return {
      pattern_type: "head_and_shoulders",
      confidence_score: round2(confidence),
      direction: "down",
      at: rs,
    };
  }
  return null;
}

/** Inverse H&S — bullish → direction "up". */
export function detectInverseHeadAndShoulders(prices: number[]): PatternHit | null {
  const lows = swingLows(prices);
  const highs = swingHighs(prices);
  if (lows.length < 3 || highs.length < 2) return null;

  for (let h = lows.length - 1; h >= 2; h--) {
    const ls = lows[h - 2]!;
    const head = lows[h - 1]!;
    const rs = lows[h]!;
    const pLS = prices[ls]!;
    const pHead = prices[head]!;
    const pRS = prices[rs]!;
    if (!(pHead < pLS && pHead < pRS)) continue;
    if (!near(pLS, pRS, 0.03)) continue;

    const peaks = highs.filter((i) => i > ls && i < rs);
    if (peaks.length < 2) continue;
    const n1 = prices[peaks[0]!]!;
    const n2 = prices[peaks[peaks.length - 1]!]!;
    const neck = (n1 + n2) / 2;

    const last = prices[prices.length - 1]!;
    const headDepth = neck - pHead;
    if (headDepth <= 0) continue;
    const broken = last >= neck * 0.998;
    const shoulderSym = 1 - Math.abs(pLS - pRS) / Math.max(Math.abs(pHead), 1e-9);
    const lift = Math.min(1, (last - pHead) / headDepth);
    let confidence = 0.45 + 0.3 * Math.max(0, Math.min(1, shoulderSym)) + 0.15 * lift;
    if (broken) confidence += 0.15;
    confidence = Math.min(0.98, confidence);
    if (confidence < 0.55) continue;
    return {
      pattern_type: "inverse_head_and_shoulders",
      confidence_score: round2(confidence),
      direction: "up",
      at: rs,
    };
  }
  return null;
}

/** Double top — bearish. */
export function detectDoubleTop(prices: number[]): PatternHit | null {
  const highs = swingHighs(prices);
  if (highs.length < 2) return null;
  for (let i = highs.length - 1; i >= 1; i--) {
    const a = highs[i - 1]!;
    const b = highs[i]!;
    if (b - a < 3) continue;
    const pa = prices[a]!;
    const pb = prices[b]!;
    if (!near(pa, pb, 0.015)) continue;
    const midLow = Math.min(...prices.slice(a, b + 1));
    const last = prices[prices.length - 1]!;
    const drop = (pa - midLow) / pa;
    if (drop < 0.01) continue;
    let confidence = 0.55 + (near(pa, pb, 0.008) ? 0.15 : 0.05);
    if (last < midLow) confidence += 0.2;
    confidence = Math.min(0.95, confidence);
    if (confidence < 0.6) continue;
    return {
      pattern_type: "double_top",
      confidence_score: round2(confidence),
      direction: "down",
      at: b,
    };
  }
  return null;
}

/** Double bottom — bullish. */
export function detectDoubleBottom(prices: number[]): PatternHit | null {
  const lows = swingLows(prices);
  if (lows.length < 2) return null;
  for (let i = lows.length - 1; i >= 1; i--) {
    const a = lows[i - 1]!;
    const b = lows[i]!;
    if (b - a < 3) continue;
    const pa = prices[a]!;
    const pb = prices[b]!;
    if (!near(pa, pb, 0.015)) continue;
    const midHigh = Math.max(...prices.slice(a, b + 1));
    const last = prices[prices.length - 1]!;
    const rise = (midHigh - pa) / pa;
    if (rise < 0.01) continue;
    let confidence = 0.55 + (near(pa, pb, 0.008) ? 0.15 : 0.05);
    if (last > midHigh) confidence += 0.2;
    confidence = Math.min(0.95, confidence);
    if (confidence < 0.6) continue;
    return {
      pattern_type: "double_bottom",
      confidence_score: round2(confidence),
      direction: "up",
      at: b,
    };
  }
  return null;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Run all detectors; return the highest-confidence hit (if any). */
export function detectBestPattern(candles: Candle[]): PatternHit | null {
  if (candles.length < 20) return null;
  const prices = closes(candles);
  const hits = [
    detectHeadAndShoulders(prices),
    detectInverseHeadAndShoulders(prices),
    detectDoubleTop(prices),
    detectDoubleBottom(prices),
  ].filter((h): h is PatternHit => h != null);
  if (hits.length === 0) return null;
  hits.sort((a, b) => b.confidence_score - a.confidence_score);
  return hits[0]!;
}

export function toSignal(
  hit: PatternHit,
  instrument: string,
  timeframe: string,
): StrategySignal {
  return {
    instrument,
    pattern_type: hit.pattern_type,
    confidence_score: hit.confidence_score,
    timeframe,
    detection_timestamp: now(),
    direction: hit.direction,
  };
}

export function patternLabel(t: PatternType): string {
  switch (t) {
    case "head_and_shoulders":
      return "Head & shoulders";
    case "inverse_head_and_shoulders":
      return "Inverse head & shoulders";
    case "double_top":
      return "Double top";
    case "double_bottom":
      return "Double bottom";
  }
}
