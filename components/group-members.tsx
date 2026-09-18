"use client";

import { useRouter } from "next/navigation";
import * as React from "react";
import { FiUserPlus, FiX } from "react-icons/fi";

import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/confirm-dialog";
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

// Group members manager. Admins get add/remove; members see a read-only
// list (no controls at all, same convention as the team page).
export function GroupMembers({
  groupSlug,
  members,
  isAdmin,
}: {
  groupSlug: string;
  members: { id: string; email: string; name: string }[];
  isAdmin: boolean;
}) {
  const router = useRouter();
  const [email, setEmail] = React.useState("");
  const [candidates, setCandidates] = React.useState<
    { id: string; email: string; name: string }[]
  >([]);
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [removing, setRemoving] = React.useState<{
    id: string;
    email: string;
  } | null>(null);
  const [removeBusy, setRemoveBusy] = React.useState(false);

  // Existing org members for the autocomplete suggestions (the input still
  // accepts any typed address — the server verifies org membership).
  React.useEffect(() => {
    if (!isAdmin) return;
    let cancelled = false;
    async function load() {
      const res = await fetch("/api/v1/team/members");
      if (!res.ok || cancelled) return;
      const body = await res.json();
      setCandidates(
        (body.members as { id: string; email: string; name: string }[]).map(
          (m) => ({ id: m.id, email: m.email, name: m.name }),
        ),
      );
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [isAdmin]);

  const suggestions = candidates.filter(
    (c) => !members.some((m) => m.id === c.id),
  );
  const listId = `group-${groupSlug}-candidates`;

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/v1/groups/${groupSlug}/members`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email }),
    });
    const body = await res.json();
    setBusy(false);
    if (!res.ok) {
      setError(body.error ?? "Could not add member");
      return;
    }
    setEmail("");
    router.refresh();
  }

  async function remove(id: string) {
    setRemoving(
      members.find((m) => m.id === id) ?? { id, email: "this member" },
    );
  }

  async function runRemove() {
    if (!removing) return;
    setRemoveBusy(true);
    setError(null);
    const res = await fetch(
      `/api/v1/groups/${groupSlug}/members/${removing.id}`,
      { method: "DELETE" },
    );
    setRemoveBusy(false);
    if (!res.ok) {
      const body = await res.json();
      setError(body.error ?? "Could not remove member");
      setRemoving(null);
      return;
    }
    setRemoving(null);
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-4">
      {isAdmin && (
        <form onSubmit={add} className="flex items-end gap-2">
          <div className="flex max-w-xs flex-1 flex-col gap-1.5">
            <Label htmlFor="member-email">Add by email</Label>
            <Input
              id="member-email"
              type="email"
              required
              list={listId}
              autoComplete="off"
              placeholder="teammate@company.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
            <datalist id={listId}>
              {suggestions.map((c) => (
                <option
                  key={c.id}
                  value={c.email}
                  label={c.name ? `${c.name} (${c.email})` : c.email}
                />
              ))}
            </datalist>
          </div>
          <Button type="submit" disabled={busy}>
            <FiUserPlus /> {busy ? "Adding…" : "Add"}
          </Button>
        </form>
      )}
      {error && (
        <p role="alert" className="text-sm text-warning">
          {error}
        </p>
      )}
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>Email</TableHead>
            {isAdmin && <TableHead className="w-16" />}
          </TableRow>
        </TableHeader>
        <TableBody>
          {members.map((m) => (
            <TableRow key={m.id}>
              <TableCell className="font-medium">{m.name || "—"}</TableCell>
              <TableCell className="text-muted-foreground">{m.email}</TableCell>
              {isAdmin && (
                <TableCell>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`Remove ${m.email}`}
                    onClick={() => remove(m.id)}
                  >
                    <FiX />
                  </Button>
                </TableCell>
              )}
            </TableRow>
          ))}
          {members.length === 0 && (
            <TableRow>
              <TableCell
                colSpan={isAdmin ? 3 : 2}
                className="py-8 text-center text-muted-foreground"
              >
                No members yet.
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
      {error && (
        <p role="alert" className="text-sm text-warning">
          {error}
        </p>
      )}
      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(o) => {
          if (!o) setRemoving(null);
        }}
        title="Remove member"
        description={
          removing
            ? `Remove ${removing.email} from this group? They immediately lose access to its projects and runs.`
            : ""
        }
        confirmLabel="Remove member"
        busy={removeBusy}
        onConfirm={() => void runRemove()}
      />
    </div>
  );
}
