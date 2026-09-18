"use client";

import * as React from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

// Onboarding kill-switch status (docs/prd-onboarding.md). One-way by design:
// an admin may close onboarding permanently, nothing re-opens it.
export function OnboardingStatusCard({
  initialDisabled,
}: {
  initialDisabled: boolean;
}) {
  const [disabled, setDisabled] = React.useState(initialDisabled);
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  async function disable() {
    if (
      !confirm(
        "Permanently disable onboarding? The setup page will never work again, on any database state. This cannot be undone.",
      )
    ) {
      return;
    }
    setBusy(true);
    setError(null);
    const res = await fetch("/api/v1/settings/onboarding", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ disabled: true }),
    });
    setBusy(false);
    if (!res.ok) {
      const body = await res.json();
      setError(body.error ?? "Could not disable onboarding");
      return;
    }
    setDisabled(true);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Onboarding</CardTitle>
        <CardDescription>
          First-time root-admin setup. Completing it closes it automatically;
          you may also close it by hand. Closed is permanent: no control
          re-opens it, and the setup endpoint refuses regardless once any
          account exists.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div>
          {disabled ? (
            <Badge variant="secondary">Permanently disabled</Badge>
          ) : (
            <Badge variant="warning">Open</Badge>
          )}
        </div>
        {error && (
          <p role="alert" className="text-sm text-warning">
            {error}
          </p>
        )}
        {!disabled && (
          <div>
            <Button
              variant="secondary"
              onClick={() => void disable()}
              disabled={busy}
            >
              {busy ? "Disabling…" : "Disable permanently"}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
