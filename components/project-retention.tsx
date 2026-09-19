"use client";

import { useRouter } from "next/navigation";
import * as React from "react";

import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

// Admin retention controls: archive toggle, metric TTL, on-demand purge.
// Purge is two-step: dry-run count first, confirmed delete second.
export function ProjectRetention({
  orgSlug,
  projectSlug,
  initialTtlDays,
  initialArchivedAt,
}: {
  orgSlug: string;
  projectSlug: string;
  initialTtlDays: number | null;
  initialArchivedAt: string | null;
}) {
  const router = useRouter();
  const [ttl, setTtl] = React.useState(
    initialTtlDays === null ? "" : String(initialTtlDays),
  );
  const [archivedAt, setArchivedAt] = React.useState<string | null>(
    initialArchivedAt,
  );
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [dryCount, setDryCount] = React.useState<number | null>(null);
  const [confirmPurge, setConfirmPurge] = React.useState(false);
  const base = `/api/v1/orgs/${orgSlug}/projects/${projectSlug}`;

  async function post(path: string, body: unknown) {
    setBusy(true);
    setError(null);
    const res = await fetch(`${base}/${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    setBusy(false);
    if (!res.ok) {
      setError(data.error ?? "Request failed");
      return null;
    }
    return data as {
      metricsTtlDays?: number | null;
      archivedAt?: string | null;
      deleted?: number;
    };
  }

  async function saveTtl(e: React.FormEvent) {
    e.preventDefault();
    const value = ttl.trim() === "" ? null : Number(ttl);
    if (value !== null && (!Number.isInteger(value) || value < 1)) {
      setError("TTL must be a whole number of days, or empty for forever");
      return;
    }
    const out = await post("retention", { metricsTtlDays: value });
    if (out) router.refresh();
  }

  async function setArchived(archived: boolean) {
    const out = await post("archive", { archived });
    if (out) {
      setArchivedAt(out.archivedAt ?? null);
      router.refresh();
    }
  }

  async function dryRun() {
    const out = await post("purge", { dryRun: true });
    if (out && typeof out.deleted === "number") {
      setDryCount(out.deleted);
      if (out.deleted > 0) setConfirmPurge(true);
    }
  }

  async function runPurge() {
    const out = await post("purge", { dryRun: false });
    if (out) {
      setConfirmPurge(false);
      setDryCount(null);
      router.refresh();
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Retention</CardTitle>
        <CardDescription>
          Metric TTL and archival. Purges delete metric points only — runs,
          summaries, and media survive.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4 text-sm">
        <div className="flex items-center justify-between gap-2">
          <span className="text-muted-foreground">
            {archivedAt ? "Archived (read-only)" : "Active"}
          </span>
          <Button
            variant="secondary"
            size="sm"
            disabled={busy}
            onClick={() => void setArchived(!archivedAt)}
          >
            {busy ? "…" : archivedAt ? "Unarchive" : "Archive"}
          </Button>
        </div>
        <form onSubmit={saveTtl} className="flex items-end gap-2">
          <div className="flex flex-1 flex-col gap-1.5">
            <Label htmlFor="retention-ttl">Metric TTL (days)</Label>
            <Input
              id="retention-ttl"
              inputMode="numeric"
              placeholder="Forever"
              value={ttl}
              onChange={(e) => setTtl(e.target.value)}
            />
          </div>
          <Button type="submit" variant="secondary" size="sm" disabled={busy}>
            Save
          </Button>
        </form>
        <div className="flex items-center justify-between gap-2">
          <span className="text-muted-foreground">
            {dryCount === null
              ? "Purge points older than the TTL"
              : `${dryCount} points would be purged`}
          </span>
          <Button
            variant="secondary"
            size="sm"
            disabled={busy}
            onClick={() => void dryRun()}
          >
            Preview purge
          </Button>
        </div>
        {error && (
          <p role="alert" className="text-xs text-warning">
            {error}
          </p>
        )}
      </CardContent>
      <ConfirmDialog
        open={confirmPurge}
        onOpenChange={(o) => {
          if (!o) setConfirmPurge(false);
        }}
        title={`Purge ${dryCount ?? 0} metric points?`}
        description="Points older than the TTL are deleted in batches. Runs, summaries, and media stay. This cannot be undone."
        confirmLabel="Purge points"
        busy={busy}
        onConfirm={() => void runPurge()}
      />
    </Card>
  );
}
