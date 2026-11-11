import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/db";
import { users } from "@/db/schema";
import { getEnv } from "@/lib/cloudflare";
import { newId } from "@/lib/ids";
import { allowLoginAttempt } from "@/lib/auth/rate-limit";
import { readJsonBody } from "@/lib/http/request";
import { RequestBodyTooLargeError } from "@/lib/http/errors";

const requestSchema = z.object({ email: z.string().email().max(320) });

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function randomToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function POST(request: Request) {
  const env = getEnv();
  if (!(await allowLoginAttempt(env, request))) {
    return NextResponse.json({ error: "Too many requests. Try again shortly." }, { status: 429, headers: { "Retry-After": "60" } });
  }

  let body: unknown;
  try {
    body = await readJsonBody(request, 16 * 1024);
  } catch (error) {
    const status = error instanceof RequestBodyTooLargeError ? 413 : 400;
    return NextResponse.json({ error: "Invalid request" }, { status });
  }

  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Enter a valid account email." }, { status: 400 });

  const generic = { ok: true, message: "If the account and recovery address match, a reset link will be sent shortly." };
  const db = getDb(env);
  const email = parsed.data.email.trim().toLowerCase();
  const [user] = await db.select({ id: users.id, resetEmail: users.resetEmail })
    .from(users).where(eq(users.email, email)).limit(1);

  if (!user?.resetEmail) {
    return NextResponse.json(generic, { headers: { "Cache-Control": "no-store" } });
  }

  const token = randomToken();
  const tokenHash = await sha256(token);
  const expiresAt = Math.floor(Date.now() / 1000) + 30 * 60;
  const tokenId = newId("prt");

  try {
    await env.DB.prepare("DELETE FROM password_reset_tokens WHERE user_id = ?").bind(user.id).run();
    await env.DB.prepare("INSERT INTO password_reset_tokens (id, user_id, token_hash, expires_at) VALUES (?, ?, ?, ?)")
      .bind(tokenId, user.id, tokenHash, expiresAt).run();

    const resetUrl = `https://mail.balansis.pw/reset-password?token=${encodeURIComponent(token)}`;
    await env.EMAIL.send({
      from: "Mailflare Security <security@balansis.pw>",
      to: user.resetEmail,
      subject: "Reset your Mailflare password",
      text: `A password reset was requested for your Mailflare account. This link expires in 30 minutes and can only be used once:\n\n${resetUrl}\n\nIf you did not request this, ignore this email.`,
      html: `<div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;color:#172033"><h2>Reset your Mailflare password</h2><p>A password reset was requested for your Mailflare account.</p><p><a href="${resetUrl}" style="display:inline-block;background:#2457e6;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none">Reset password</a></p><p>This link expires in 30 minutes and can only be used once.</p><p>If you did not request this, you can safely ignore this email.</p></div>`,
    });
  } catch (error) {
    console.error("Password reset email could not be sent", error);
    await env.DB.prepare("DELETE FROM password_reset_tokens WHERE id = ?").bind(tokenId).run().catch(() => undefined);
  }

  return NextResponse.json(generic, { headers: { "Cache-Control": "no-store" } });
}
