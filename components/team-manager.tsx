"use client";

import { useRouter } from "next/navigation";
import * as React from "react";
import { FiCopy, FiMoreVertical, FiUserPlus } from "react-icons/fi";

import { Badge } from "@/components/ui/badge";
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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

export interface MemberRow {
  id: string;
  email: string;
  role: "SUPER_ADMIN" | "MEMBER";
  createdAt: string;
}

// Members see a read-only list (no action column at all — visibly obvious).
// Super admins get invite + row actions.
export function TeamManager({
  members,
  isAdmin,
}: {
  members: MemberRow[];
  isAdmin: boolean;
}) {
  const router = useRouter();
  const [inviteOpen, setInviteOpen] = React.useState(false);
  const [email, setEmail] = React.useState("");
  const [inviteUrl, setInviteUrl] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [copied, setCopied] = React.useState(false);

  async function invite(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await fetch("/api/v1/team/invite", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email }),
    });
    const body = await res.json();
    setBusy(false);
    if (!res.ok) {
      setError(body.error ?? "Invite failed");
      return;
    }
    // No email infra in v1 — show the link to copy manually (§5.3).
    setInviteUrl(`${window.location.origin}${body.inviteUrl}`);
  }

  async function setRole(id: string, role: string) {
    const res = await fetch(`/api/v1/team/members/${id}/role`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ role }),
    });
    if (!res.ok) {
      const body = await res.json();
      alert(body.error ?? "Could not change role");
      return;
    }
    router.refresh();
  }

  async function remove(id: string, targetEmail: string) {
    if (
      !confirm(
        `Deactivate ${targetEmail}? They lose access immediately and their API keys are revoked. Their runs stay attributed to them.`,
      )
    ) {
      return;
    }
    const res = await fetch(`/api/v1/team/members/${id}`, {
      method: "DELETE",
    });
    if (!res.ok) {
      const body = await res.json();
      alert(body.error ?? "Could not deactivate");
      return;
    }
    router.refresh();
  }

  function closeInvite() {
    setInviteOpen(false);
    setEmail("");
    setInviteUrl(null);
    setError(null);
    setCopied(false);
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-4">
      {isAdmin && (
        <div className="flex justify-end">
          <Dialog
            open={inviteOpen}
            onOpenChange={(o) => (o ? setInviteOpen(true) : closeInvite())}
          >
            <DialogTrigger asChild>
              <Button>
                <FiUserPlus /> Invite Member
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Invite a member</DialogTitle>
                <DialogDescription>
                  They join as a member. Copy the link and send it yourself —
                  Cursus sends no email in v1.
                </DialogDescription>
              </DialogHeader>
              {inviteUrl ? (
                <div className="flex flex-col gap-3">
                  <code className="break-all rounded-md bg-muted p-3 font-mono text-xs">
                    {inviteUrl}
                  </code>
                  <DialogFooter>
                    <Button
                      onClick={() => {
                        void navigator.clipboard.writeText(inviteUrl);
                        setCopied(true);
                      }}
                    >
                      <FiCopy /> {copied ? "Copied" : "Copy link"}
                    </Button>
                  </DialogFooter>
                </div>
              ) : (
                <form onSubmit={invite} className="flex flex-col gap-4">
                  <div className="flex flex-col gap-2">
                    <Label htmlFor="invite-email">Email</Label>
                    <Input
                      id="invite-email"
                      type="email"
                      required
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                    />
                  </div>
                  {error && (
                    <p role="alert" className="text-sm text-warning">
                      {error}
                    </p>
                  )}
                  <DialogFooter>
                    <Button type="submit" disabled={busy}>
                      {busy ? "Inviting…" : "Generate invite link"}
                    </Button>
                  </DialogFooter>
                </form>
              )}
            </DialogContent>
          </Dialog>
        </div>
      )}

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Email</TableHead>
            <TableHead>Role</TableHead>
            <TableHead>Joined</TableHead>
            {isAdmin && <TableHead className="w-16" />}
          </TableRow>
        </TableHeader>
        <TableBody>
          {members.map((m) => (
            <TableRow key={m.id}>
              <TableCell className="font-medium">{m.email}</TableCell>
              <TableCell>
                <Badge
                  variant={m.role === "SUPER_ADMIN" ? "default" : "secondary"}
                >
                  {m.role === "SUPER_ADMIN" ? "super admin" : "member"}
                </Badge>
              </TableCell>
              <TableCell className="text-xs text-muted-foreground">
                {new Date(m.createdAt).toLocaleDateString()}
              </TableCell>
              {isAdmin && (
                <TableCell>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={`Actions for ${m.email}`}
                      >
                        <FiMoreVertical />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      {m.role === "MEMBER" ? (
                        <DropdownMenuItem
                          onClick={() => void setRole(m.id, "SUPER_ADMIN")}
                        >
                          Promote to super admin
                        </DropdownMenuItem>
                      ) : (
                        <DropdownMenuItem
                          onClick={() => void setRole(m.id, "MEMBER")}
                        >
                          Demote to member
                        </DropdownMenuItem>
                      )}
                      <DropdownMenuItem
                        onClick={() => void remove(m.id, m.email)}
                      >
                        Deactivate
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </TableCell>
              )}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
