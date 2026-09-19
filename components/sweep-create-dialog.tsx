"use client";

import { useRouter } from "next/navigation";
import * as React from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const EXAMPLE_SPACE = `{
  "lr": { "min": 0.0001, "max": 0.1, "scale": "log" },
  "batch": { "values": [16, 32] }
}`;

// Sweep creation dialog: grid needs values[] on every dim, random takes
// values[] (choice) or min/max (uniform, log optional).
export function SweepCreateDialog({ projectSlug }: { projectSlug: string }) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [name, setName] = React.useState("");
  const [method, setMethod] = React.useState("RANDOM");
  const [space, setSpace] = React.useState(EXAMPLE_SPACE);
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    let parsed: unknown;
    try {
      parsed = JSON.parse(space);
    } catch {
      setError("Space is not valid JSON");
      return;
    }
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/v1/projects/${projectSlug}/sweeps`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name, method, space: parsed }),
    });
    const body = await res.json();
    setBusy(false);
    if (!res.ok) {
      setError(body.error ?? "Could not create sweep");
      return;
    }
    setOpen(false);
    router.refresh();
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>New sweep</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New sweep</DialogTitle>
          <DialogDescription>
            Grid or random search over a declared space. Workers pull trials
            with <code className="font-mono">cursus.next_trial</code>.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={create} className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="sweep-name">Name</Label>
            <Input
              id="sweep-name"
              required
              maxLength={128}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="sweep-method">Method</Label>
            <select
              id="sweep-method"
              value={method}
              onChange={(e) => setMethod(e.target.value)}
              className="h-9 rounded-md border border-input bg-card px-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <option value="RANDOM">Random</option>
              <option value="GRID">Grid</option>
            </select>
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="sweep-space">Search space (JSON)</Label>
            <textarea
              id="sweep-space"
              required
              rows={7}
              className="rounded-md border border-input bg-card px-3 py-2 font-mono text-xs shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              value={space}
              onChange={(e) => setSpace(e.target.value)}
            />
          </div>
          {error && (
            <p role="alert" className="text-sm text-warning">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button type="submit" disabled={busy}>
              {busy ? "Creating…" : "Create sweep"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
