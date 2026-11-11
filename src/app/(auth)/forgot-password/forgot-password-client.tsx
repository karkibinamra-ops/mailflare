"use client";

import { useState } from "react";
import Link from "next/link";
import { Mail } from "lucide-react";
import { AuthShell } from "@/components/auth/auth-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function ForgotPasswordClient() {
  const [email, setEmail] = useState("admin@balansis.pw");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setMessage(null);
    setError(null);
    try {
      const response = await fetch("/api/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Unable to request a reset link.");
      setMessage(data.message ?? "Check your recovery inbox for a reset link.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to request a reset link.");
    } finally {
      setLoading(false);
    }
  }

  return <AuthShell icon={Mail} title="Reset your password" description="We’ll send a one-time reset link to the recovery email saved on your account.">
    <form onSubmit={onSubmit} className="space-y-5">
      <div className="space-y-2">
        <Label htmlFor="email">Mailflare account email</Label>
        <Input id="email" type="email" autoComplete="username" value={email} onChange={(event) => setEmail(event.target.value)} required />
      </div>
      {message && <p role="status" className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">{message}</p>}
      {error && <p role="alert" className="rounded-2xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}
      <Button type="submit" className="h-11 w-full rounded-full" disabled={loading}>{loading ? "Sending..." : "Send reset link"}</Button>
      <p className="text-center text-sm text-muted-foreground"><Link href="/login" className="font-medium underline underline-offset-4">Back to sign in</Link></p>
    </form>
  </AuthShell>;
}
