"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import * as React from "react";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";

// Split-screen login modeled on the SAGEA platform login: brand panel with
// the form card on the left, full-height artwork on the right. Deliberately
// light-themed — a standalone route, not part of the dark dashboard.
export function LoginForm() {
  const router = useRouter();
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await fetch("/api/v1/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    const body = await res.json();
    setBusy(false);
    if (!res.ok) {
      setError(body.error ?? "Login failed");
      return;
    }
    router.push(`/${body.org.slug}/projects`);
    router.refresh();
  }

  return (
    <main className="flex min-h-screen bg-[#f4f4f5] text-neutral-900">
      <div className="flex flex-1 flex-col items-center justify-center px-6 py-12">
        <Image
          src="/sagea_banner.png"
          alt="SAGEA"
          width={600}
          height={163}
          className="h-9 w-auto invert"
          priority
        />
        <p className="mt-4 text-[15px] font-medium text-neutral-700">
          Experiment tracking by SAGEA
        </p>

        <div className="mt-10 w-full max-w-md rounded-2xl border border-neutral-200 bg-white p-8 shadow-sm">
          <div className="flex flex-col items-center text-center">
            <Image
              src="/cursos.svg"
              alt="Cursus"
              width={140}
              height={140}
              className="h-12 w-12"
            />
            <h1 className="mt-6 text-[26px] font-bold tracking-tight">
              Welcome back
            </h1>
            <p className="mt-1.5 text-sm text-neutral-500">
              Enter your credentials to access Cursus
            </p>
          </div>

          <form onSubmit={onSubmit} className="mt-7 flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="email">Email address</Label>
              <input
                id="email"
                type="email"
                autoComplete="email"
                required
                placeholder="name@company.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="h-10 w-full rounded-md border border-neutral-200 bg-white px-3 text-sm shadow-sm transition-colors placeholder:text-neutral-400 focus:outline-none focus:ring-2 focus:ring-neutral-900"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="password">Password</Label>
              <input
                id="password"
                type="password"
                autoComplete="current-password"
                required
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="h-10 w-full rounded-md border border-neutral-200 bg-white px-3 text-sm shadow-sm transition-colors placeholder:text-neutral-400 focus:outline-none focus:ring-2 focus:ring-neutral-900"
              />
            </div>
            {error && (
              <p role="alert" className="text-sm text-red-600">
                {error}
              </p>
            )}
            <Button
              type="submit"
              disabled={busy}
              className="h-10 w-full bg-neutral-900 text-sm font-medium text-white hover:bg-neutral-800"
            >
              {busy ? "Signing in…" : "Sign in"}
            </Button>
          </form>

          <p className="text-center text-sm mt-4 text-neutral-600">
            Need an account?{" "}
            <span className="font-medium text-neutral-900">
              Ask your super admin for an invite
            </span>
          </p>
        </div>

        <p className="mt-5 max-w-md text-center text-xs leading-relaxed text-neutral-500">
          By continuing, you agree to the SAGEA Noncommercial License. Cursus is
          free to use and adapt, but not for commercial sale.
        </p>
      </div>

      <div className="relative hidden flex-1 lg:block">
        <Image
          src="/artwork.webp"
          alt=""
          fill
          sizes="50vw"
          className="object-cover"
          priority
        />
      </div>
    </main>
  );
}
