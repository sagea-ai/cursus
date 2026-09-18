"use client";

import * as React from "react";
import { FiClock } from "react-icons/fi";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

interface HistoryEvent {
  id: string;
  action: string;
  targetType: string;
  targetId: string | null;
  metadata: { label?: string } | null;
  createdAt: string;
  actor: { email: string; name: string };
}

function describeAction(action: string): string {
  switch (action) {
    case "api_key.created":
      return "Created";
    case "api_key.rotated":
      return "Rotated";
    case "api_key.revoked":
      return "Revoked";
    default:
      return action;
  }
}

// Audit history dialog: who did what to which key, and when. Revoked keys
// live here — never in the active-keys table.
export function KeyHistoryDialog() {
  const [open, setOpen] = React.useState(false);
  const [events, setEvents] = React.useState<HistoryEvent[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  async function load() {
    setError(null);
    const res = await fetch("/api/v1/audit");
    if (!res.ok) {
      setError("Could not load history");
      setEvents([]);
      return;
    }
    const body = await res.json();
    setEvents(body.events as HistoryEvent[]);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o) void load();
        else {
          setEvents(null);
          setError(null);
        }
      }}
    >
      <DialogTrigger asChild>
        <Button variant="secondary">
          <FiClock /> History
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>API key history</DialogTitle>
          <DialogDescription>
            Creations, rotations, and revocations — including keys that no
            longer exist.
          </DialogDescription>
        </DialogHeader>
        {error && (
          <p role="alert" className="text-sm text-warning">
            {error}
          </p>
        )}
        {events === null ? (
          <p className="py-4 text-center text-sm text-muted-foreground">
            Loading…
          </p>
        ) : events.length === 0 ? (
          <p className="py-4 text-center text-sm text-muted-foreground">
            No key activity yet.
          </p>
        ) : (
          <div className="max-h-[50vh] overflow-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>When</TableHead>
                  <TableHead>Action</TableHead>
                  <TableHead>Key</TableHead>
                  <TableHead>By</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {events.map((e) => (
                  <TableRow key={e.id}>
                    <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                      {new Date(e.createdAt).toLocaleString()}
                    </TableCell>
                    <TableCell className="text-xs font-medium">
                      {describeAction(e.action)}
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {e.metadata?.label ?? e.targetId?.slice(0, 8) ?? "—"}
                    </TableCell>
                    <TableCell className="max-w-44 truncate text-xs text-muted-foreground">
                      {e.actor.name || e.actor.email}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
