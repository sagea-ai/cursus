"use client";

import { useRouter } from "next/navigation";
import * as React from "react";

import { Button } from "@/components/ui/button";

// Admin-only: move a project between groups (or back to org-wide).
// Membership is re-checked server-side; a stale dropdown can never escalate.
const NONE = "__none__";

export function ProjectGroupMove({
  orgSlug,
  projectSlug,
  current,
}: {
  orgSlug: string;
  projectSlug: string;
  current: { slug: string; name: string } | null;
}) {
  const router = useRouter();
  const [groups, setGroups] = React.useState<{ slug: string; name: string }[]>(
    [],
  );
  const [value, setValue] = React.useState(current?.slug ?? NONE);
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
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
  }, []);

  const dirty = value !== (current?.slug ?? NONE);

  async function save() {
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/v1/orgs/${orgSlug}/projects/${projectSlug}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ group: value === NONE ? null : value }),
    });
    setBusy(false);
    if (!res.ok) {
      const body = await res.json();
      setError(body.error ?? "Could not move project");
      return;
    }
    router.refresh();
  }

  return (
    <span className="flex items-center gap-1.5">
      <select
        value={value}
        onChange={(e) => setValue(e.target.value)}
        aria-label="Project group"
        className="h-8 rounded-md border border-input bg-card px-2 text-xs shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <option value={NONE}>No group (org-wide)</option>
        {groups.map((g) => (
          <option key={g.slug} value={g.slug}>
            {g.name}
          </option>
        ))}
      </select>
      <Button size="sm" disabled={!dirty || busy} onClick={() => void save()}>
        {busy ? "Moving…" : "Move"}
      </Button>
      {error && (
        <span role="alert" className="text-xs text-warning">
          {error}
        </span>
      )}
    </span>
  );
}
