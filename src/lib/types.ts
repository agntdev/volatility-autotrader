/** Durable domain types for Deriv SynthIndex AutoTrader. */

export type TradeStatus =
  | "pending"
  | "open"
  | "closed"
  | "cancelled"
  | "failed"
  | "sl_hit"
  | "tp_hit";

export type TradeDirection = "up" | "down";

export type PatternType =
  | "head_and_shoulders"
  | "inverse_head_and_shoulders"
  | "double_top"
  | "double_bottom";

export interface User {
  telegram_id: string;
  /** AES-GCM ciphertext of the Deriv API token (base64). */
  encrypted_api_token?: string;
  language_preference: string;
  accepted_terms: boolean;
  accepted_terms_at?: number;
  autotrade_enabled: boolean;
  instruments: string[];
  timeframes: string[];
  created_at: number;
  updated_at: number;
  /** Last balance seen (for min-threshold alerts); not a live quote. */
  last_balance?: number;
  last_currency?: string;
  balance_alert_sent?: boolean;
}

export interface RiskProfile {
  max_risk_percent: number;
  max_concurrent_trades: number;
  tp_multiplier: number;
  /** Default stop-loss distance as fraction of stake (e.g. 0.5 = 50% of stake). */
  sl_fraction: number;
}

export interface Trade {
  id: string;
  telegram_id: string;
  instrument: string;
  direction: TradeDirection;
  stake: number;
  stop_loss: number;
  take_profit: number;
  entry_time: number;
  status: TradeStatus;
  exit_time?: number;
  pnl?: number;
  pattern_type?: PatternType;
  confidence_score?: number;
  timeframe?: string;
  contract_id?: string;
  currency?: string;
  notes?: string;
}

export interface StrategySignal {
  instrument: string;
  pattern_type: PatternType;
  confidence_score: number;
  timeframe: string;
  detection_timestamp: number;
  direction: TradeDirection;
}

/** Owner-level controls (single global record). */
export interface OwnerSettings {
  instruments: string[];
  confidence_threshold: number;
  default_risk_percent: number;
  default_max_concurrent: number;
  default_tp_multiplier: number;
  default_sl_fraction: number;
  manual_override_enabled: boolean;
  min_balance_alert: number;
  scan_interval_ms: number;
}

export const DEFAULT_INSTRUMENTS = ["R_50", "R_75"] as const;
export const DEFAULT_TIMEFRAMES = ["60", "300"] as const; // 1m, 5m in seconds

export const DEFAULT_RISK: RiskProfile = {
  max_risk_percent: 1,
  max_concurrent_trades: 1,
  tp_multiplier: 2,
  sl_fraction: 0.5,
};

export const DEFAULT_OWNER: OwnerSettings = {
  instruments: [...DEFAULT_INSTRUMENTS],
  confidence_threshold: 0.7,
  default_risk_percent: 1,
  default_max_concurrent: 1,
  default_tp_multiplier: 2,
  default_sl_fraction: 0.5,
  manual_override_enabled: true,
  min_balance_alert: 5,
  scan_interval_ms: 60_000,
};

/** Human labels for Deriv synthetic symbols. */
export const INSTRUMENT_LABELS: Record<string, string> = {
  R_50: "Volatility 50",
  R_75: "Volatility 75",
  R_100: "Volatility 100",
  "1HZ50V": "Volatility 50 (1s)",
  "1HZ75V": "Volatility 75 (1s)",
};

export function instrumentLabel(symbol: string): string {
  return INSTRUMENT_LABELS[symbol] ?? symbol;
}
