import { AuthGuard } from "@/components/auth/auth-guard";
import { ResetPasswordClient } from "./reset-password-client";

export const dynamic = "force-dynamic";

export default async function ResetPasswordPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token = "" } = await searchParams;
  return <AuthGuard mode="public"><ResetPasswordClient token={token} /></AuthGuard>;
}
