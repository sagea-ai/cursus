"use client";

import { useRouter } from "next/navigation";
import * as React from "react";

import { StatusBadge } from "@/components/status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export interface SweepRunRow {
  id: string;
  name: string;
  status: string;
  startedAt: string;
  runHref: string;
}

const STATE_VARIANT = {
  RUNNING: "active",
  FINISHED: "secondary",
  CANCELLED: "revoke",
} as const;

// Sweep detail: state badge + space + member runs + finish/cancel.
// Runs table reuses the run-row shape (badge, name link, started).
export function SweepDetail({
  sweep,
  runs,
  canWrite,
}: {
  sweep: {
    id: string;
    name: string;
    method: string;
    state: string;
    space: unknown;
    runCount: number;
    createdBy: string;
  };
  runs: SweepRunRow[];
  canWrite: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function setState(state: string) {
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/v1/sweeps/${sweep.id}/state`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ state }),
    });
    setBusy(false);
    if (!res.ok) {
      const body = await res.json();
      setError(body.error ?? "Could not update sweep");
      return;
    }
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center gap-3">
        <Badge
          variant={STATE_VARIANT[sweep.state as keyof typeof STATE_VARIANT]}
        >
          {sweep.state}
        </Badge>
        <span className="text-sm text-muted-foreground">
          {sweep.method} · {sweep.runCount}{" "}
          {sweep.runCount === 1 ? "run" : "runs"} · by {sweep.createdBy}
        </span>
        {sweep.state === "RUNNING" && canWrite && (
          <span className="ml-auto flex gap-2">
            <Button
              variant="secondary"
              disabled={busy}
              onClick={() => void setState("FINISHED")}
            >
              Finish
            </Button>
            <Button
              variant="secondary"
              disabled={busy}
              onClick={() => void setState("CANCELLED")}
            >
              Cancel
            </Button>
          </span>
        )}
      </div>
      {error && (
        <p role="alert" className="text-sm text-warning">
          {error}
        </p>
      )}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Search space</CardTitle>
          <CardDescription>
            Workers pull trials with{" "}
            <code className="font-mono">
              cursus.next_trial(&quot;{sweep.id}&quot;)
            </code>
          </CardDescription>
        </CardHeader>
        <CardContent>
          <pre className="overflow-x-auto rounded-md bg-muted p-4 font-mono text-xs leading-relaxed">
            {JSON.stringify(sweep.space, null, 2)}
          </pre>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Trials</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {runs.length === 0 ? (
            <p className="p-5 text-sm text-muted-foreground">
              No trials yet — pull one with{" "}
              <code className="font-mono">next_trial</code>.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Status</TableHead>
                  <TableHead>Run</TableHead>
                  <TableHead>Started</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {runs.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell>
                      <StatusBadge status={r.status} />
                    </TableCell>
                    <TableCell>
                      <a href={r.runHref} className="hover:underline">
                        {r.name}
                      </a>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {new Date(r.startedAt).toLocaleString()}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
