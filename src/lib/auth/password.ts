import bcrypt from "bcryptjs";

const PBKDF2_PREFIX = "pbkdf2-sha256";
const PBKDF2_ITERATIONS = 100_000;

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

function fromBase64(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i += 1) result |= a[i] ^ b[i];
  return result === 0;
}

async function derive(password: string, salt: Uint8Array): Promise<ArrayBuffer> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  return crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt,
      iterations: PBKDF2_ITERATIONS,
      hash: "SHA-256",
    },
    key,
    256,
  );
}

/**
 * New passwords use Web Crypto PBKDF2 instead of synchronous bcrypt.
 * This avoids blocking a Cloudflare Worker request while retaining support
 * for existing bcrypt password hashes.
 */
export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const derived = new Uint8Array(await derive(password, salt));
  return `${PBKDF2_PREFIX}$${PBKDF2_ITERATIONS}$${toBase64(salt)}$${toBase64(derived)}`;
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  if (!hash.startsWith(`${PBKDF2_PREFIX}$`)) {
    return bcrypt.compare(password, hash);
  }

  const [, iterationsText, saltText, expectedText] = hash.split("$");
  const iterations = Number(iterationsText);
  if (iterations !== PBKDF2_ITERATIONS || !saltText || !expectedText) return false;

  const salt = fromBase64(saltText);
  const expected = fromBase64(expectedText);
  const actual = new Uint8Array(await derive(password, salt));
  return constantTimeEqual(actual, expected);
}
