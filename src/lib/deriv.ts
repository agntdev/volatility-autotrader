/**
 * Deriv WebSocket API client (real contract).
 *
 * Endpoint: wss://ws.derivws.com/websockets/v3?app_id=<APP_ID>
 * Auth: authorize with the user's API token.
 * Trading: proposal → buy; history: ticks_history; account: balance.
 *
 * Credentials: DERIV_APP_ID (optional, default 1089 public demo app) + per-user
 * API token stored encrypted. No fabricated balances or fills.
 */

export interface DerivBalance {
  balance: number;
  currency: string;
  loginid?: string;
}

export interface Candle {
  epoch: number;
  open: number;
  high: number;
  low: number;
  close: number;
}

export interface DerivProposal {
  id: string;
  ask_price: number;
  payout?: number;
  spot?: number;
}

export interface DerivBuyResult {
  contract_id: string;
  buy_price: number;
  balance_after?: number;
  shortcode?: string;
  transaction_id?: number;
}

export interface DerivSellResult {
  sold_for: number;
  contract_id: string;
  transaction_id?: number;
}

export class DerivError extends Error {
  constructor(
    message: string,
    public readonly code?: string | number,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "DerivError";
  }
}

export type DerivTransport = {
  request: (payload: Record<string, unknown>) => Promise<Record<string, unknown>>;
  close: () => void;
};

type WsLike = {
  readyState: number;
  send: (data: string) => void;
  close: () => void;
  addEventListener: (type: string, fn: (ev: { data: unknown }) => void) => void;
  removeEventListener: (type: string, fn: (ev: { data: unknown }) => void) => void;
};

const OPEN = 1;

function appId(): string {
  const env = typeof process !== "undefined" ? process.env : {};
  return env.DERIV_APP_ID || "1089";
}

function wsUrl(): string {
  return `wss://ws.derivws.com/websockets/v3?app_id=${appId()}`;
}

/** Open a one-shot request session over Deriv's WebSocket API. */
export async function openDerivSession(
  apiToken: string,
  opts?: { timeoutMs?: number },
): Promise<DerivTransport> {
  const timeoutMs = opts?.timeoutMs ?? 15_000;
  const WS = (globalThis as unknown as { WebSocket?: new (url: string) => WsLike }).WebSocket;
  if (!WS) {
    throw new DerivError("WebSocket is not available in this runtime");
  }

  const socket = new WS(wsUrl());
  let reqId = 1;
  const pending = new Map<
    number,
    { resolve: (v: Record<string, unknown>) => void; reject: (e: Error) => void }
  >();

  const onMessage = (ev: { data: unknown }) => {
    try {
      const raw = typeof ev.data === "string" ? ev.data : String(ev.data);
      const msg = JSON.parse(raw) as Record<string, unknown>;
      const id = msg.req_id as number | undefined;
      if (id != null && pending.has(id)) {
        const p = pending.get(id)!;
        pending.delete(id);
        if (msg.error) {
          const err = msg.error as { message?: string; code?: string | number };
          p.reject(new DerivError(err.message ?? "Deriv API error", err.code, msg.error));
        } else {
          p.resolve(msg);
        }
      }
    } catch {
      /* ignore malformed frames */
    }
  };

  await new Promise<void>((resolve, reject) => {
    const t = setTimeout(() => reject(new DerivError("Deriv connection timed out")), timeoutMs);
    const onOpen = () => {
      clearTimeout(t);
      resolve();
    };
    const onErr = () => {
      clearTimeout(t);
      reject(new DerivError("Could not reach Deriv — check your connection and try again"));
    };
    socket.addEventListener("open", onOpen as (ev: { data: unknown }) => void);
    socket.addEventListener("error", onErr as (ev: { data: unknown }) => void);
    socket.addEventListener("message", onMessage);
  });

  const request = (payload: Record<string, unknown>): Promise<Record<string, unknown>> => {
    if (socket.readyState !== OPEN) {
      return Promise.reject(new DerivError("Deriv connection is closed"));
    }
    const id = reqId++;
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => {
        pending.delete(id);
        reject(new DerivError("Deriv request timed out"));
      }, timeoutMs);
      pending.set(id, {
        resolve: (v) => {
          clearTimeout(t);
          resolve(v);
        },
        reject: (e) => {
          clearTimeout(t);
          reject(e);
        },
      });
      socket.send(JSON.stringify({ ...payload, req_id: id }));
    });
  };

  // Authorize with the user token before handing the session out.
  await request({ authorize: apiToken });

  return {
    request,
    close: () => {
      try {
        socket.close();
      } catch {
        /* ignore */
      }
      for (const [, p] of pending) p.reject(new DerivError("Deriv connection closed"));
      pending.clear();
    },
  };
}

/** Fetch account balance for the authorized token. */
export async function fetchBalance(apiToken: string): Promise<DerivBalance> {
  const session = await openDerivSession(apiToken);
  try {
    const msg = await session.request({ balance: 1, account: "current" });
    const bal = msg.balance as {
      balance?: number;
      currency?: string;
      loginid?: string;
    };
    if (bal?.balance == null) {
      throw new DerivError("Balance response missing fields", undefined, msg);
    }
    return {
      balance: Number(bal.balance),
      currency: bal.currency ?? "USD",
      loginid: bal.loginid,
    };
  } finally {
    session.close();
  }
}

/**
 * Fetch OHLC candles via ticks_history (candles style).
 * `granularity` is seconds (60 = 1m, 300 = 5m).
 */
export async function fetchCandles(
  apiToken: string,
  symbol: string,
  granularity: number,
  count = 100,
): Promise<Candle[]> {
  const session = await openDerivSession(apiToken);
  try {
    const end = Math.floor(Date.now() / 1000);
    const msg = await session.request({
      ticks_history: symbol,
      adjust_start_time: 1,
      count,
      end,
      granularity,
      style: "candles",
    });
    const candles = (msg.candles ?? msg.history) as
      | Array<{ epoch?: number; open?: number; high?: number; low?: number; close?: number }>
      | undefined;
    if (!Array.isArray(candles) || candles.length === 0) {
      // Some responses put arrays under history.prices — treat as hard miss.
      throw new DerivError(`No candle data for ${symbol}`, undefined, msg);
    }
    return candles.map((c) => ({
      epoch: Number(c.epoch ?? 0),
      open: Number(c.open),
      high: Number(c.high),
      low: Number(c.low),
      close: Number(c.close),
    }));
  } finally {
    session.close();
  }
}

export interface BuyMultiplierParams {
  symbol: string;
  direction: "up" | "down";
  stake: number;
  currency: string;
  multiplier?: number;
  stopLoss: number;
  takeProfit: number;
}

/** Price a multiplier contract then buy it. */
export async function buyMultiplier(
  apiToken: string,
  params: BuyMultiplierParams,
): Promise<DerivBuyResult> {
  const session = await openDerivSession(apiToken);
  try {
    const contractType = params.direction === "up" ? "MULTUP" : "MULTDOWN";
    const proposalMsg = await session.request({
      proposal: 1,
      amount: params.stake,
      basis: "stake",
      contract_type: contractType,
      currency: params.currency,
      symbol: params.symbol,
      multiplier: params.multiplier ?? 100,
      limit_order: {
        stop_loss: params.stopLoss,
        take_profit: params.takeProfit,
      },
    });
    const proposal = proposalMsg.proposal as DerivProposal | undefined;
    if (!proposal?.id) {
      throw new DerivError("No proposal returned", undefined, proposalMsg);
    }
    const buyMsg = await session.request({
      buy: proposal.id,
      price: proposal.ask_price,
    });
    const buy = buyMsg.buy as {
      contract_id?: number | string;
      buy_price?: number;
      balance_after?: number;
      shortcode?: string;
      transaction_id?: number;
    };
    if (buy?.contract_id == null) {
      throw new DerivError("Buy failed — no contract id", undefined, buyMsg);
    }
    return {
      contract_id: String(buy.contract_id),
      buy_price: Number(buy.buy_price ?? params.stake),
      balance_after: buy.balance_after != null ? Number(buy.balance_after) : undefined,
      shortcode: buy.shortcode,
      transaction_id: buy.transaction_id,
    };
  } finally {
    session.close();
  }
}

/** Sell (close) an open contract by id. */
export async function sellContract(
  apiToken: string,
  contractId: string,
  price = 0,
): Promise<DerivSellResult> {
  const session = await openDerivSession(apiToken);
  try {
    const msg = await session.request({
      sell: contractId,
      price,
    });
    const sell = msg.sell as {
      sold_for?: number;
      contract_id?: number | string;
      transaction_id?: number;
    };
    if (sell?.sold_for == null && sell?.contract_id == null) {
      throw new DerivError("Sell failed", undefined, msg);
    }
    return {
      sold_for: Number(sell.sold_for ?? 0),
      contract_id: String(sell.contract_id ?? contractId),
      transaction_id: sell.transaction_id,
    };
  } finally {
    session.close();
  }
}

/** Human-readable Deriv error for Telegram (no stack / codes). */
export function derivErrorMessage(err: unknown): string {
  if (err instanceof DerivError) {
    if (String(err.message).toLowerCase().includes("rate")) {
      return "Deriv is rate-limiting right now. Wait a moment and try again.";
    }
    if (String(err.message).toLowerCase().includes("reach")) {
      return "Couldn't reach Deriv. Check your connection and try again.";
    }
    // Strip raw error codes; keep the message if it's already plain.
    const m = err.message.replace(/\s*\(code:?\s*[^)]+\)/i, "").trim();
    return m || "Deriv request failed. Try again in a moment.";
  }
  if (err instanceof Error) return "Something went wrong talking to Deriv. Try again.";
  return "Something went wrong talking to Deriv. Try again.";
}
