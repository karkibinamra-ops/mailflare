import { NextResponse } from "next/server";
import { z } from "zod";
import { getEnv } from "@/lib/cloudflare";
import { hashPassword } from "@/lib/auth/password";
import { readJsonBody } from "@/lib/http/request";
import { RequestBodyTooLargeError } from "@/lib/http/errors";

const resetSchema = z.object({
  token: z.string().regex(/^[a-f0-9]{64}$/),
  newPassword: z.string().min(12).max(128),
});

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function POST(request: Request) {
  const env = getEnv();
  let body: unknown;
  try {
    body = await readJsonBody(request, 16 * 1024);
  } catch (error) {
    const status = error instanceof RequestBodyTooLargeError ? 413 : 400;
    return NextResponse.json({ error: "Invalid request" }, { status });
  }

  const parsed = resetSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Use a valid reset link and a password of at least 12 characters." }, { status: 400 });

  const tokenHash = await sha256(parsed.data.token);
  const now = Math.floor(Date.now() / 1000);
  const result = await env.DB.prepare(
    "SELECT id, user_id FROM password_reset_tokens WHERE token_hash = ? AND expires_at > ? LIMIT 1",
  ).bind(tokenHash, now).first<{ id: string; user_id: string }>();

  if (!result) return NextResponse.json({ error: "This reset link is invalid or has expired. Request a new one." }, { status: 400 });

  const passwordHash = await hashPassword(parsed.data.newPassword);
  await env.DB.prepare("UPDATE users SET password_hash = ? WHERE id = ?").bind(passwordHash, result.user_id).run();
  await env.DB.prepare("DELETE FROM sessions WHERE user_id = ?").bind(result.user_id).run();
  await env.DB.prepare("DELETE FROM password_reset_tokens WHERE user_id = ?").bind(result.user_id).run();

  return NextResponse.json({ ok: true, message: "Password updated. You can now sign in." }, { headers: { "Cache-Control": "no-store" } });
}
