"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import * as React from "react";

import { AuthShell, authInputClass } from "@/components/auth-shell";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";

// Two-step first-run onboarding (docs/prd-onboarding.md): step 1 gates on
// the bootstrap email, step 2 collects identity + the twice-entered password
// behind a must-acknowledge one-time disclaimer.
export function OnboardingForm({ orgSuggestion }: { orgSuggestion: string }) {
  const router = useRouter();
  const [step, setStep] = React.useState<1 | 2>(1);
  const [email, setEmail] = React.useState("");
  const [name, setName] = React.useState("");
  const [orgName, setOrgName] = React.useState(orgSuggestion);
  const [password, setPassword] = React.useState("");
  const [confirm, setConfirm] = React.useState("");
  const [ack, setAck] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (password !== confirm) {
      setError("Passwords do not match");
      return;
    }
    if (!ack) {
      setError("Please acknowledge that onboarding cannot be done again");
      return;
    }
    setBusy(true);
    setError(null);
    const res = await fetch("/api/v1/auth/bootstrap", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ orgName, name, email, password }),
    });
    const body = await res.json();
    setBusy(false);
    if (!res.ok) {
      setError(body.error ?? "Onboarding failed");
      return;
    }
    router.push(`/${body.org.slug}/projects`);
    router.refresh();
  }

  return (
    <AuthShell
      tagline="Set up your Cursus workspace"
      footnote={
        <p>
          Onboarding can be completed exactly once. Afterwards this page is
          permanently disabled.
        </p>
      }
      card={
        <>
          <div className="flex flex-col items-center text-center">
            <Image
              src="/cursos.svg"
              alt="Cursus"
              width={140}
              height={140}
              className="h-12 w-12"
            />
            <h1 className="mt-6 text-[26px] font-bold tracking-tight">
              Welcome to Cursus
            </h1>
            <p className="mt-1.5 text-sm text-neutral-500">
              {step === 1
                ? "Enter your bootstrap email to begin setup"
                : "Tell us who you are, then lock it in"}
            </p>
          </div>

          {step === 1 ? (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                setError(null);
                setStep(2);
              }}
              className="mt-7 flex flex-col gap-4"
            >
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="ob-email">Bootstrap email</Label>
                <input
                  id="ob-email"
                  type="email"
                  autoComplete="email"
                  required
                  placeholder="you@company.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className={authInputClass}
                />
                <p className="text-xs text-neutral-500">
                  The address in BOOTSTRAP_ADMIN_EMAIL. Nothing is checked until
                  you submit.
                </p>
              </div>
              <Button
                type="submit"
                className="h-10 w-full bg-neutral-900 text-sm font-medium text-white hover:bg-neutral-800"
              >
                Continue
              </Button>
            </form>
          ) : (
            <form onSubmit={onSubmit} className="mt-7 flex flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="ob-name">Your name</Label>
                <input
                  id="ob-name"
                  required
                  maxLength={128}
                  placeholder="Ada Lovelace"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className={authInputClass}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="ob-role">Role</Label>
                <input
                  id="ob-role"
                  value="Super admin"
                  disabled
                  aria-describedby="ob-role-note"
                  className={authInputClass}
                />
                <p id="ob-role-note" className="text-xs text-neutral-500">
                  The first account must own the org, so this is locked.
                </p>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="ob-org">Organization name</Label>
                <input
                  id="ob-org"
                  required
                  maxLength={128}
                  placeholder="Acme"
                  value={orgName}
                  onChange={(e) => setOrgName(e.target.value)}
                  className={authInputClass}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="ob-login-email">Login email</Label>
                <input
                  id="ob-login-email"
                  value={email}
                  disabled
                  className={authInputClass}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="ob-password">Password</Label>
                <input
                  id="ob-password"
                  type="password"
                  autoComplete="new-password"
                  required
                  minLength={8}
                  placeholder="At least 8 characters"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className={authInputClass}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="ob-confirm">Confirm password</Label>
                <input
                  id="ob-confirm"
                  type="password"
                  autoComplete="new-password"
                  required
                  minLength={8}
                  placeholder="Repeat it exactly"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  className={authInputClass}
                />
              </div>

              <label
                htmlFor="ob-ack"
                className="flex cursor-pointer items-start gap-2.5 rounded-md border border-amber-300 bg-amber-50 p-3 text-[13px] leading-snug text-neutral-800"
              >
                <input
                  id="ob-ack"
                  type="checkbox"
                  checked={ack}
                  onChange={(e) => setAck(e.target.checked)}
                  className="mt-0.5 size-4 accent-neutral-900"
                />
                <span>
                  <strong>Strict one-time setup.</strong> After this account is
                  created, onboarding is permanently disabled and new accounts
                  can only be created by invitation from a super admin. I
                  understand this cannot be done again.
                </span>
              </label>

              {error && (
                <p role="alert" className="text-sm text-red-600">
                  {error}
                </p>
              )}
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setStep(1);
                    setError(null);
                  }}
                  className="h-10 border-neutral-300 bg-white text-neutral-700 hover:bg-neutral-100"
                >
                  Back
                </Button>
                <Button
                  type="submit"
                  disabled={busy}
                  className="h-10 flex-1 bg-neutral-900 text-sm font-medium text-white hover:bg-neutral-800"
                >
                  {busy ? "Creating workspace…" : "Create workspace"}
                </Button>
              </div>
            </form>
          )}
        </>
      }
    />
  );
}
