"use client";

import { useRouter } from "next/navigation";
import * as React from "react";
import { FiPlus } from "react-icons/fi";

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

export function NewProjectDialog({ orgSlug }: { orgSlug: string }) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [name, setName] = React.useState("");
  const [group, setGroup] = React.useState("__none__");
  const [groups, setGroups] = React.useState<{ slug: string; name: string }[]>(
    [],
  );
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  // Groups the caller belongs to (admins: all) for the placement picker.
  React.useEffect(() => {
    if (!open) return;
    let cancelled = false;
    async function load() {
      const res = await fetch("/api/v1/groups");
      if (!res.ok || cancelled) return;
      const body = await res.json();
      setGroups(
        (body.groups as { slug: string; name: string }[]).map((g) => ({
          slug: g.slug,
          name: g.name,
        })),
      );
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [open ]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/v1/orgs/${orgSlug}/projects`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name,
        ...(group === "__none__" ? {} : { group }),
      }),
    });
    const body = await res.json();
    setBusy(false);
    if (!res.ok) {
      setError(body.error ?? "Could not create project");
      return;
    }
    setOpen(false);
    setName("");
    setGroup("__none__");
    router.refresh();
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <FiPlus /> New Project
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New project</DialogTitle>
          <DialogDescription>
            Group related training runs. A URL slug is derived from the name.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="project-name">Name</Label>
            <Input
              id="project-name"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="sage-pretrain"
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="project-group">Group (optional)</Label>
            <select
              id="project-group"
              value={group}
              onChange={(e) => setGroup(e.target.value)}
              className="h-9 rounded-md border border-input bg-card px-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <option value="__none__">No group (org-wide)</option>
              {groups.map((g) => (
                <option key={g.slug} value={g.slug}>
                  {g.name}
                </option>
              ))}
            </select>
            <p className="text-xs text-muted-foreground">
              Grouped projects are visible only to group members.
            </p>
          </div>
          {error && (
            <p role="alert" className="text-sm text-warning">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button type="submit" disabled={busy}>
              {busy ? "Creating…" : "Create project"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
