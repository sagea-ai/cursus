"use client";

import { useRouter } from "next/navigation";
import * as React from "react";
import { FiUserPlus, FiX } from "react-icons/fi";

import { Button } from "@/components/ui/button";
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
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

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

  async function remove(id: string, targetEmail: string) {
    if (!confirm(`Remove ${targetEmail} from this group?`)) return;
    const res = await fetch(`/api/v1/groups/${groupSlug}/members/${id}`, {
      method: "DELETE",
    });
    if (!res.ok) {
      const body = await res.json();
      alert(body.error ?? "Could not remove member");
      return;
    }
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
              placeholder="teammate@company.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
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
                    onClick={() => void remove(m.id, m.email)}
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
    </div>
  );
}
