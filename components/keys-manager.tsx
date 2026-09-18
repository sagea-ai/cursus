"use client";

import { useRouter } from "next/navigation";
import * as React from "react";
import { FiCopy, FiPlus } from "react-icons/fi";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/confirm-dialog";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export interface KeyRow {
  id: string;
  label: string;
  ownerEmail?: string;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
}

export function KeysManager({
  keys,
  isAdmin,
}: {
  keys: KeyRow[];
  isAdmin: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [label, setLabel] = React.useState("");
  const [plaintext, setPlaintext] = React.useState<string | null>(null);
  const [revealedFor, setRevealedFor] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [copied, setCopied] = React.useState(false);
  const [confirming, setConfirming] = React.useState<
    | { kind: "revoke"; id: string; label: string; owner?: string }
    | { kind: "rotate"; id: string; label: string; owner?: string }
    | null
  >(null);
  const [confirmBusy, setConfirmBusy] = React.useState(false);
  const [actionError, setActionError] = React.useState<string | null>(null);

  function describeKey(keyLabel: string, owner?: string) {
    return owner ? `${owner}'s key "${keyLabel}"` : `key "${keyLabel}"`;
  }

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await fetch("/api/v1/keys", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ label }),
    });
    const body = await res.json();
    setBusy(false);
    if (!res.ok) {
      setError(body.error ?? "Could not create key");
      return;
    }
    // Shown exactly once — the server never stores it.
    setPlaintext(body.plaintext);
  }

  function close() {
    setOpen(false);
    setLabel("");
    setPlaintext(null);
    setRevealedFor(null);
    setError(null);
    setCopied(false);
    router.refresh();
  }

  async function runConfirmedAction() {
    if (!confirming) return;
    setConfirmBusy(true);
    setActionError(null);
    if (confirming.kind === "revoke") {
      const res = await fetch(`/api/v1/keys/${confirming.id}`, {
        method: "DELETE",
      });
      setConfirmBusy(false);
      if (!res.ok) {
        const body = await res.json();
        setActionError(body.error ?? "Could not revoke key");
        return;
      }
      setConfirming(null);
      router.refresh();
      return;
    }
    const res = await fetch(`/api/v1/keys/${confirming.id}/rotate`, {
      method: "POST",
    });
    const body = await res.json();
    setConfirmBusy(false);
    if (!res.ok) {
      setActionError(body.error ?? "Could not rotate key");
      return;
    }
    // Reveal the replacement exactly once, reusing the create dialog.
    setConfirming(null);
    setRevealedFor(`Rotated replacement for "${confirming.label}"`);
    setPlaintext(body.plaintext);
    setOpen(true);
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {isAdmin
            ? "All keys in the org. Revoking someone else's key breaks their running jobs — confirm carefully."
            : "Your keys. Use one per machine as CURSUS_API_KEY."}
        </p>
        <Dialog open={open} onOpenChange={(o) => (o ? setOpen(true) : close())}>
          <DialogTrigger asChild>
            <Button>
              <FiPlus /> Create Key
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>
                {revealedFor ? "Key rotated" : "Create API key"}
              </DialogTitle>
              <DialogDescription>
                {revealedFor ??
                  "Name it after the machine or job that will use it."}
              </DialogDescription>
            </DialogHeader>
            {plaintext ? (
              <div className="flex flex-col gap-3">
                <p className="text-sm font-medium text-warning">
                  Copy it now — you won&apos;t see this again.
                </p>
                <code className="break-all rounded-md bg-muted p-3 font-mono text-xs">
                  {plaintext}
                </code>
                <DialogFooter>
                  <Button
                    onClick={() => {
                      void navigator.clipboard.writeText(plaintext);
                      setCopied(true);
                    }}
                  >
                    <FiCopy /> {copied ? "Copied" : "Copy key"}
                  </Button>
                </DialogFooter>
              </div>
            ) : (
              <form onSubmit={create} className="flex flex-col gap-4">
                <div className="flex flex-col gap-2">
                  <Label htmlFor="key-label">Label</Label>
                  <Input
                    id="key-label"
                    required
                    value={label}
                    onChange={(e) => setLabel(e.target.value)}
                    placeholder="training-box-1"
                  />
                </div>
                {error && (
                  <p role="alert" className="text-sm text-warning">
                    {error}
                  </p>
                )}
                <DialogFooter>
                  <Button type="submit" disabled={busy}>
                    {busy ? "Creating…" : "Create key"}
                  </Button>
                </DialogFooter>
              </form>
            )}
          </DialogContent>
        </Dialog>
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Label</TableHead>
            {isAdmin && <TableHead>Owner</TableHead>}
            <TableHead>Created</TableHead>
            <TableHead>Last used</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="w-40" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {keys.map((k) => (
            <TableRow key={k.id}>
              <TableCell className="font-medium">{k.label}</TableCell>
              {isAdmin && (
                <TableCell className="text-xs text-muted-foreground">
                  {k.ownerEmail}
                </TableCell>
              )}
              <TableCell className="text-xs text-muted-foreground">
                {new Date(k.createdAt).toLocaleDateString()}
              </TableCell>
              <TableCell className="text-xs text-muted-foreground">
                {k.lastUsedAt
                  ? new Date(k.lastUsedAt).toLocaleString()
                  : "Never"}
              </TableCell>
              <TableCell>
                {k.revokedAt ? (
                  <Badge variant="warning">Revoked</Badge>
                ) : (
                  <Badge variant="active">Active</Badge>
                )}
              </TableCell>
              <TableCell>
                {!k.revokedAt && (
                  <span className="flex gap-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() =>
                        setConfirming({
                          kind: "rotate",
                          id: k.id,
                          label: k.label,
                          owner: k.ownerEmail,
                        })
                      }
                    >
                      Rotate
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() =>
                        setConfirming({
                          kind: "revoke",
                          id: k.id,
                          label: k.label,
                          owner: k.ownerEmail,
                        })
                      }
                    >
                      Revoke
                    </Button>
                  </span>
                )}
              </TableCell>
            </TableRow>
          ))}
          {keys.length === 0 && (
            <TableRow>
              <TableCell
                colSpan={isAdmin ? 6 : 5}
                className="py-8 text-center text-muted-foreground"
              >
                No keys yet. Create one to connect a training script.
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
      {actionError && (
        <p role="alert" className="text-sm text-warning">
          {actionError}
        </p>
      )}
      <ConfirmDialog
        open={confirming !== null}
        onOpenChange={(o) => {
          if (!o) setConfirming(null);
        }}
        title={
          confirming?.kind === "rotate" ? "Rotate API key" : "Revoke API key"
        }
        description={
          confirming?.kind === "rotate"
            ? `Rotate ${describeKey(confirming.label, confirming.owner)}? A replacement key is issued and shown once; the old secret stops working immediately. Update CURSUS_API_KEY wherever it is used.`
            : confirming
              ? `Revoke ${describeKey(confirming.label, confirming.owner)}? Any training job using it will fail to log from that moment on.`
              : ""
        }
        confirmLabel={confirming?.kind === "rotate" ? "Rotate key" : "Revoke key"}
        busy={confirmBusy}
        onConfirm={() => void runConfirmedAction()}
      />
    </div>
  );
}
