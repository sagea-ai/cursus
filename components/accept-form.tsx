"use client";

import { useRouter } from "next/navigation";
import * as React from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PasswordFields, passwordMeetsAll } from "@/components/password-fields";

export function AcceptForm({ token }: { token: string }) {
  const router = useRouter();
  const [name, setName] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [confirm, setConfirm] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (name.trim().length === 0) {
      setError("Enter your display name");
      return;
    }
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
      body: JSON.stringify({ token, password, name: name.trim() }),
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
      <div className="flex flex-col gap-2">
        <Label htmlFor="accept-name">Display name</Label>
        <Input
          id="accept-name"
          type="text"
          required
          maxLength={128}
          autoComplete="name"
          placeholder="Ada Lovelace"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <p className="text-xs text-muted-foreground">
          Set once here — afterwards only a super admin can change it.
        </p>
      </div>
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
