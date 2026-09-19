"use client";

import { useRouter } from "next/navigation";
import * as React from "react";

import { Button } from "@/components/ui/button";
import { PasswordFields, passwordMeetsAll } from "@/components/password-fields";

export function AcceptForm({ token }: { token: string }) {
  const router = useRouter();
  const [password, setPassword] = React.useState("");
  const [confirm, setConfirm] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (password !== confirm) {
      setError("Passwords do not match");
      return;
    }
    if (!passwordMeetsAll(password)) {
      setError("Password does not meet all requirements above");
      return;
    }
    setBusy(true);
    setError(null);
    const res = await fetch("/api/v1/auth/invites/accept", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token, password }),
    });
    const body = await res.json();
    setBusy(false);
    if (!res.ok) {
      setError(body.error ?? "Could not accept invite");
      return;
    }
    router.push(`/${body.org.slug}/dashboard`);
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="mt-7 flex flex-col gap-4">
      <PasswordFields
        password={password}
        confirm={confirm}
        onPassword={setPassword}
        onConfirm={setConfirm}
        idPrefix="accept"
        passwordLabel="Choose a password"
        confirmLabel="Confirm password"
      />
      {error && (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      )}
      <Button type="submit" disabled={busy}>
        {busy ? "Joining…" : "Set password and join"}
      </Button>
    </form>
  );
}
