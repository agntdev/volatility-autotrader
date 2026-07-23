/**
 * Durable key-value store for domain data (users, trades, risk, settings).
 *
 * Backed by Redis when REDIS_URL is set (production Node), otherwise an
 * in-memory adapter (dev / test harness). Never enumerate the keyspace —
 * always read through explicit index records.
 *
 * Cloudflare Workers: Redis is unavailable; the same API uses memory in the
 * isolate unless a future D1 binding is wired. Session state still uses ChatDO.
 */

import type { StorageAdapter } from "grammy";
import { MemorySessionStorage } from "../toolkit/session/memory.js";
import { defaultRedisStorage } from "../toolkit/session/redis.js";

export interface KvStore {
  get<T>(key: string): Promise<T | undefined>;
  set<T>(key: string, value: T): Promise<void>;
  delete(key: string): Promise<void>;
}

function wrapAdapter(adapter: StorageAdapter<string>): KvStore {
  return {
    async get<T>(key: string): Promise<T | undefined> {
      const raw = await adapter.read(key);
      if (raw == null) return undefined;
      try {
        return JSON.parse(raw) as T;
      } catch {
        return undefined;
      }
    },
    async set<T>(key: string, value: T): Promise<void> {
      await adapter.write(key, JSON.stringify(value));
    },
    async delete(key: string): Promise<void> {
      await adapter.delete(key);
    },
  };
}

let memoryAdapter: MemorySessionStorage<string> | null = null;
let store: KvStore | null = null;

function createStore(): KvStore {
  const env = typeof process !== "undefined" ? process.env : {};
  if (env.REDIS_URL) {
    // Redis path — values stored as JSON strings under prefix durable:
    const redis = defaultRedisStorage<string>(env.REDIS_URL);
    // defaultRedisStorage prefixes with sess: — re-wrap with our own prefix via keys
    return {
      async get<T>(key: string): Promise<T | undefined> {
        const raw = await redis.read("durable:" + key);
        if (raw == null) return undefined;
        try {
          return (typeof raw === "string" ? JSON.parse(raw) : raw) as T;
        } catch {
          return undefined;
        }
      },
      async set<T>(key: string, value: T): Promise<void> {
        await redis.write("durable:" + key, JSON.stringify(value) as unknown as string);
      },
      async delete(key: string): Promise<void> {
        await redis.delete("durable:" + key);
      },
    };
  }
  memoryAdapter = new MemorySessionStorage<string>();
  return wrapAdapter(memoryAdapter);
}

/** Process-wide durable store (Redis or memory). */
export function getStore(): KvStore {
  if (!store) store = createStore();
  return store;
}

/**
 * Reset in-memory durable data. Used by the test harness between specs so
 * dialog runs are isolated. No-op when Redis is configured.
 */
export function resetStoreForTests(): void {
  const env = typeof process !== "undefined" ? process.env : {};
  if (env.REDIS_URL) return;
  memoryAdapter = new MemorySessionStorage<string>();
  store = wrapAdapter(memoryAdapter);
}

// ── Key helpers (no SCAN / KEYS) ──────────────────────────────────────────

export const keys = {
  user: (telegramId: string) => `user:${telegramId}`,
  risk: (telegramId: string) => `risk:${telegramId}`,
  trade: (tradeId: string) => `trade:${tradeId}`,
  /** Explicit index of trade ids for a user (newest first). */
  tradeIndex: (telegramId: string) => `tradeidx:${telegramId}`,
  /** Explicit index of users with autotrade enabled. */
  autotradeIndex: () => `idx:autotrade`,
  owner: () => `owner:settings`,
};
