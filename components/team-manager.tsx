"use client";

import { useRouter } from "next/navigation";
import * as React from "react";
import { FiCopy, FiMoreVertical, FiUserPlus } from "react-icons/fi";

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
  name: string;
  role: "SUPER_ADMIN" | "MEMBER";
  status: "active" | "pending" | "inactive";
  createdAt: string;
}

const STATUS_META = {
  active: { label: "Active", variant: "active" as const },
  pending: { label: "Pending", variant: "warning" as const },
  inactive: { label: "Inactive", variant: "revoke" as const },
};

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
  const [deactivating, setDeactivating] = React.useState<{
    id: string;
    email: string;
  } | null>(null);
  const [deleting, setDeleting] = React.useState<{
    id: string;
    email: string;
  } | null>(null);
  const [renaming, setRenaming] = React.useState<{
    id: string;
    email: string;
    name: string;
  } | null>(null);
  const [shareLink, setShareLink] = React.useState<{
    email: string;
    url: string;
  } | null>(null);
  const [confirmBusy, setConfirmBusy] = React.useState(false);
  const [actionError, setActionError] = React.useState<string | null>(null);

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
    setActionError(null);
    const res = await fetch(`/api/v1/team/members/${id}/role`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ role }),
    });
    if (!res.ok) {
      const body = await res.json();
      setActionError(body.error ?? "Could not change role");
      return;
    }
    router.refresh();
  }

  async function runDeactivate() {
    if (!deactivating) return;
    setConfirmBusy(true);
    setActionError(null);
    const res = await fetch(`/api/v1/team/members/${deactivating.id}`, {
      method: "DELETE",
    });
    setConfirmBusy(false);
    if (!res.ok) {
      const body = await res.json();
      setActionError(body.error ?? "Could not deactivate");
      return;
    }
    setDeactivating(null);
    router.refresh();
  }

  // Reactivate an inactive member, or mint a fresh link for a pending one
  // (the old link may have expired — tokens live 1 hour). Shows the link
  // to copy, same as the invite flow.
  async function runReactivate(id: string, email: string) {
    setActionError(null);
    setConfirmBusy(true);
    const res = await fetch(`/api/v1/team/members/${id}/reactivate`, {
      method: "POST",
    });
    setConfirmBusy(false);
    if (!res.ok) {
      const body = await res.json();
      setActionError(body.error ?? "Could not reactivate");
      return;
    }
    const body = await res.json();
    setShareLink({
      email,
      url: `${window.location.origin}${body.inviteUrl}`,
    });
  }

  async function runDelete() {
    if (!deleting) return;
    setConfirmBusy(true);
    setActionError(null);
    const res = await fetch(`/api/v1/team/members/${deleting.id}/delete`, {
      method: "POST",
    });
    setConfirmBusy(false);
    if (!res.ok) {
      const body = await res.json();
      setActionError(body.error ?? "Could not delete");
      return;
    }
    setDeleting(null);
    router.refresh();
  }

  async function runRename(e: React.FormEvent) {
    e.preventDefault();
    if (!renaming || renaming.name.trim().length === 0) return;
    setConfirmBusy(true);
    setActionError(null);
    const res = await fetch(`/api/v1/team/members/${renaming.id}/name`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: renaming.name.trim() }),
    });
    setConfirmBusy(false);
    if (!res.ok) {
      const body = await res.json();
      setActionError(body.error ?? "Could not rename");
      return;
    }
    setRenaming(null);
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
                  They join as a member. Copy the link and send it yourself.
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
            <TableHead>Name</TableHead>
            <TableHead>Email</TableHead>
            <TableHead>Role</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Joined</TableHead>
            {isAdmin && <TableHead className="w-16" />}
          </TableRow>
        </TableHeader>
        <TableBody>
          {members.map((m) => (
            <TableRow key={m.id}>
              <TableCell className="font-medium">{m.name || "—"}</TableCell>
              <TableCell className="text-muted-foreground">{m.email}</TableCell>
              <TableCell>
                <Badge
                  variant={m.role === "SUPER_ADMIN" ? "default" : "secondary"}
                >
                  {m.role === "SUPER_ADMIN" ? "super admin" : "member"}
                </Badge>
              </TableCell>
              <TableCell>
                <Badge variant={STATUS_META[m.status].variant}>
                  {STATUS_META[m.status].label}
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
                      <DropdownMenuItem
                        onClick={() =>
                          setRenaming({
                            id: m.id,
                            email: m.email,
                            name: m.name,
                          })
                        }
                      >
                        Rename
                      </DropdownMenuItem>
                      {m.status === "active" && (
                        <>
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
                            onClick={() =>
                              setDeactivating({ id: m.id, email: m.email })
                            }
                          >
                            Deactivate
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={() =>
                              setDeleting({ id: m.id, email: m.email })
                            }
                          >
                            Delete…
                          </DropdownMenuItem>
                        </>
                      )}
                      {m.status === "pending" && (
                        <>
                          <DropdownMenuItem
                            onClick={() => void runReactivate(m.id, m.email)}
                          >
                            Copy new invite link
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={() =>
                              setDeactivating({ id: m.id, email: m.email })
                            }
                          >
                            Revoke invite
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={() =>
                              setDeleting({ id: m.id, email: m.email })
                            }
                          >
                            Delete…
                          </DropdownMenuItem>
                        </>
                      )}
                      {m.status === "inactive" && (
                        <>
                          <DropdownMenuItem
                            onClick={() => void runReactivate(m.id, m.email)}
                          >
                            Reactivate
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={() =>
                              setDeleting({ id: m.id, email: m.email })
                            }
                          >
                            Delete…
                          </DropdownMenuItem>
                        </>
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </TableCell>
              )}
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {actionError && (
        <p role="alert" className="text-sm text-warning">
          {actionError}
        </p>
      )}
      <ConfirmDialog
        open={deactivating !== null}
        onOpenChange={(o) => {
          if (!o) setDeactivating(null);
        }}
        title="Deactivate member"
        description={
          deactivating
            ? `Deactivate ${deactivating.email}? They lose access immediately and their API keys are revoked. Their runs stay attributed to them.`
            : ""
        }
        confirmLabel="Deactivate"
        busy={confirmBusy}
        onConfirm={() => void runDeactivate()}
      />
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(o) => {
          if (!o) setDeleting(null);
        }}
        title="Delete account"
        description={
          deleting
            ? `Permanently delete ${deleting.email}? Their runs, artifacts, groups, and audit entries will be reassigned to you, and their API keys removed. This cannot be undone — deactivate instead to keep the account.`
            : ""
        }
        confirmLabel="Delete permanently"
        busy={confirmBusy}
        onConfirm={() => void runDelete()}
      />
      <Dialog
        open={renaming !== null}
        onOpenChange={(o) => {
          if (!o) setRenaming(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rename member</DialogTitle>
            <DialogDescription>
              {renaming ? `Change the display name for ${renaming.email}.` : ""}
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={runRename} className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="rename-name">Display name</Label>
              <Input
                id="rename-name"
                type="text"
                required
                maxLength={128}
                value={renaming?.name ?? ""}
                onChange={(e) =>
                  setRenaming((r) => (r ? { ...r, name: e.target.value } : r))
                }
              />
            </div>
            <DialogFooter>
              <Button type="submit" disabled={confirmBusy}>
                {confirmBusy ? "Saving…" : "Save name"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      <Dialog
        open={shareLink !== null}
        onOpenChange={(o) => {
          if (!o) {
            setShareLink(null);
            setCopied(false);
            router.refresh();
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Invite link</DialogTitle>
            <DialogDescription>
              {shareLink
                ? `Send this to ${shareLink.email}. It expires after 1 hour.`
                : ""}
            </DialogDescription>
          </DialogHeader>
          {shareLink && (
            <div className="flex flex-col gap-3">
              <code className="break-all rounded-md bg-muted p-3 font-mono text-xs">
                {shareLink.url}
              </code>
              <DialogFooter>
                <Button
                  onClick={() => {
                    void navigator.clipboard.writeText(shareLink.url);
                    setCopied(true);
                  }}
                >
                  <FiCopy /> {copied ? "Copied" : "Copy link"}
                </Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
