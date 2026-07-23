/**
 * Encrypt / decrypt Deriv API tokens with WebCrypto AES-GCM.
 * Works on Node 20+ and Cloudflare Workers (no node:crypto).
 */

const enc = new TextEncoder();
const dec = new TextDecoder();

function b64encode(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]!);
  return btoa(s);
}

function b64decode(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function deriveKey(secret: string): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: enc.encode("agntdev-deriv-synth-v1"),
      iterations: 100_000,
      hash: "SHA-256",
    },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

function secretFromEnv(): string {
  const env = typeof process !== "undefined" ? process.env : {};
  return (
    env.TOKEN_ENCRYPTION_KEY ||
    env.DERIV_TOKEN_SECRET ||
    env.BOT_TOKEN ||
    "dev-insecure-token-encryption-key"
  );
}

/** Encrypt a plaintext API token → base64(iv || ciphertext). */
export async function encryptToken(plaintext: string): Promise<string> {
  const key = await deriveKey(secretFromEnv());
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    enc.encode(plaintext),
  );
  const packed = new Uint8Array(iv.length + cipher.byteLength);
  packed.set(iv, 0);
  packed.set(new Uint8Array(cipher), iv.length);
  return b64encode(packed);
}

/** Decrypt a token previously produced by encryptToken. */
export async function decryptToken(packedB64: string): Promise<string> {
  const key = await deriveKey(secretFromEnv());
  const packed = b64decode(packedB64);
  const iv = packed.slice(0, 12);
  const data = packed.slice(12);
  const plain = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv },
    key,
    data,
  );
  return dec.decode(plain);
}
