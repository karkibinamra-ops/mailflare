"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { authFetch, getClientSessionToken } from "@/lib/auth/client";

export function HomeActions({ hero = false }: { hero?: boolean }) {
  const [hasUser, setHasUser] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (!getClientSessionToken()) return;

    authFetch("/api/auth/me", { redirectOnUnauthorized: false })
      .then((response) => {
        if (!cancelled) setHasUser(response.ok);
      })
      .catch(() => {
        if (!cancelled) setHasUser(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  if (hero) {
    return (
      <>
        <Button size="lg" asChild className="rounded-full px-6">
          <Link href={hasUser ? "/inbox" : "/setup"}>
            {hasUser ? "Open dashboard" : "Create account"}
            <ArrowRight className="h-4 w-4" />
          </Link>
        </Button>
        <Button
          size="lg"
          variant="outline"
          asChild
          className="rounded-full border-neutral-200 bg-white px-6"
        >
          <Link href={hasUser ? "/inbox" : "/login"}>
            {hasUser ? "View inbox" : "Log in"}
          </Link>
        </Button>
      </>
    );
  }

  return (
    <>
      <Button variant="outline" asChild>
        <Link href="/login">Log in</Link>
      </Button>
      <Button variant="default" asChild>
        <Link href="/setup">Create account</Link>
      </Button>
    </>
  );
}
