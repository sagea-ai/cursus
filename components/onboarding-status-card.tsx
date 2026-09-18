"use client";

import * as React from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/confirm-dialog";
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
  const [confirming, setConfirming] = React.useState(false);

  async function runDisable() {
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
      setConfirming(false);
      return;
    }
    setConfirming(false);
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
              onClick={() => setConfirming(true)}
              disabled={busy}
            >
              Disable permanently
            </Button>
          </div>
        )}
        <ConfirmDialog
          open={confirming}
          onOpenChange={(o) => {
            if (!o) setConfirming(false);
          }}
          title="Disable onboarding"
          description="Permanently disable onboarding? The setup page will never work again, on any database state. This cannot be undone."
          confirmLabel="Disable permanently"
          busy={busy}
          onConfirm={() => void runDisable()}
        />
      </CardContent>
    </Card>
  );
}
