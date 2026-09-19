"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import * as React from "react";
import { FiGitMerge } from "react-icons/fi";

import { StatusBadge } from "@/components/status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export interface RunRow {
  id: string;
  name: string;
  status: string;
  tags: string[];
  notes: string;
  group: { slug: string; name: string } | null;
  summary: Record<string, number>;
  createdBy: string;
  startedAt: string;
  finishedAt: string | null;
}

function duration(start: string, end: string | null): string {
  const ms =
    (end ? new Date(end).getTime() : Date.now()) - new Date(start).getTime();
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
}

const SORT_OPTIONS = [
  { value: "recent", label: "Recent" },
  { value: "oldest", label: "Oldest" },
  { value: "name_asc", label: "Name A–Z" },
  { value: "name_desc", label: "Name Z–A" },
] as const;

export function RunsTable({
  runs,
  sort,
  basePath,
  orgSlug,
  projectSlug,
  canWrite,
}: {
  runs: RunRow[];
  sort: string;
  basePath: string;
  orgSlug: string;
  projectSlug: string;
  canWrite: boolean;
}) {
  const router = useRouter();
  const [query, setQuery] = React.useState("");
  const [status, setStatus] = React.useState<string>("ALL");
  const [selected, setSelected] = React.useState<string[]>([]);
  const [bulkTag, setBulkTag] = React.useState("");
  const [bulkBusy, setBulkBusy] = React.useState(false);
  const [bulkError, setBulkError] = React.useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = React.useState(false);

  const summaryKeys = React.useMemo(() => {
    const keys = new Set<string>();
    for (const r of runs) for (const k of Object.keys(r.summary)) keys.add(k);
    return [...keys].slice(0, 4);
  }, [runs]);

  const filtered = runs.filter((r) => {
    if (status !== "ALL" && r.status !== status) return false;
    if (!query) return true;
    const q = query.toLowerCase();
    return (
      r.name.toLowerCase().includes(q) ||
      r.tags.some((t) => t.toLowerCase().includes(q))
    );
  });

  function toggle(id: string) {
    // Compare takes 2–5; bulk ops take up to 100. One selection serves both.
    setSelected((prev) =>
      prev.includes(id)
        ? prev.filter((x) => x !== id)
        : prev.length >= 100
          ? prev
          : [...prev, id],
    );
  }

  function toggleAll() {
    setSelected((prev) =>
      prev.length === filtered.length ? [] : filtered.map((r) => r.id),
    );
  }

  async function runBatch(op: "delete" | "tag") {
    if (selected.length === 0) return;
    if (op === "tag" && bulkTag.trim().length === 0) return;
    setBulkBusy(true);
    setBulkError(null);
    const res = await fetch(`/api/v1/projects/${projectSlug}/runs/batch`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(
        op === "tag"
          ? { ids: selected, op, tags: [bulkTag.trim()] }
          : { ids: selected, op },
      ),
    });
    setBulkBusy(false);
    if (!res.ok) {
      const body = await res.json();
      setBulkError(body.error ?? "Bulk action failed");
      return;
    }
    setSelected([]);
    setBulkTag("");
    setConfirmDelete(false);
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <Input
          placeholder="Search name or tag…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="max-w-xs"
        />
        {(["ALL", "RUNNING", "FINISHED", "CRASHED", "KILLED"] as const).map(
          (s) => (
            <Button
              key={s}
              variant={status === s ? "default" : "ghost"}
              size="sm"
              onClick={() => setStatus(s)}
            >
              {s === "ALL" ? "All" : s.charAt(0) + s.slice(1).toLowerCase()}
            </Button>
          ),
        )}
        <span className="flex items-center gap-1 text-xs text-muted-foreground">
          Sort:
          {SORT_OPTIONS.map((o) => (
            <Link
              key={o.value}
              href={`${basePath}?sort=${o.value}`}
              aria-current={sort === o.value ? "true" : undefined}
              className={
                sort === o.value
                  ? "rounded px-1.5 py-1 font-medium text-foreground underline underline-offset-4"
                  : "rounded px-1.5 py-1 hover:text-foreground"
              }
            >
              {o.label}
            </Link>
          ))}
        </span>
        <div className="ml-auto">
          <Link
            href={
              selected.length >= 2 && selected.length <= 5
                ? `${basePath}/compare?ids=${selected.join(",")}`
                : "#"
            }
            aria-disabled={selected.length < 2 || selected.length > 5}
            onClick={(e) => {
              if (selected.length < 2 || selected.length > 5)
                e.preventDefault();
            }}
          >
            <Button
              variant="secondary"
              disabled={selected.length < 2 || selected.length > 5}
            >
              <FiGitMerge /> Compare ({selected.length})
            </Button>
          </Link>
        </div>
      </div>

      {canWrite && selected.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-muted/40 px-3 py-2">
          <span className="text-xs font-medium">
            {selected.length} selected
          </span>
          <Input
            placeholder="Tag to add…"
            value={bulkTag}
            onChange={(e) => setBulkTag(e.target.value)}
            aria-label="Bulk tag"
            className="h-8 w-36 text-xs"
          />
          <Button
            variant="secondary"
            size="sm"
            disabled={bulkBusy || bulkTag.trim().length === 0}
            onClick={() => void runBatch("tag")}
          >
            {bulkBusy ? "Tagging…" : "Tag"}
          </Button>
          <Button
            variant="secondary"
            size="sm"
            disabled={bulkBusy}
            onClick={() => setConfirmDelete(true)}
            className="text-warning"
          >
            Delete…
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setSelected([])}>
            Clear
          </Button>
          {bulkError && (
            <span role="alert" className="text-xs text-warning">
              {bulkError}
            </span>
          )}
        </div>
      )}

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-10">
              <input
                type="checkbox"
                aria-label="Select all runs"
                checked={
                  filtered.length > 0 && selected.length === filtered.length
                }
                onChange={toggleAll}
                className="size-4 accent-[#1976FD]"
              />
            </TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Name</TableHead>
            <TableHead>Notes</TableHead>
            <TableHead>Group</TableHead>
            <TableHead>Tags</TableHead>
            <TableHead>By</TableHead>
            <TableHead>Created</TableHead>
            <TableHead>Duration</TableHead>
            {summaryKeys.map((k) => (
              <TableHead key={k} className="font-mono text-[11px]">
                {k}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {filtered.map((r) => (
            <TableRow
              key={r.id}
              data-state={selected.includes(r.id) ? "selected" : undefined}
            >
              <TableCell>
                <input
                  type="checkbox"
                  aria-label={`Select ${r.name}`}
                  checked={selected.includes(r.id)}
                  onChange={() => toggle(r.id)}
                  className="size-4 accent-[#1976FD]"
                />
              </TableCell>
              <TableCell>
                <StatusBadge status={r.status} />
              </TableCell>
              <TableCell>
                <Link
                  href={`${basePath}/${r.id}`}
                  className="font-medium text-accent-pale hover:underline"
                >
                  {r.name}
                </Link>
              </TableCell>
              <TableCell
                className="max-w-48 truncate text-xs text-muted-foreground"
                title={r.notes || undefined}
              >
                {r.notes || "—"}
              </TableCell>
              <TableCell>
                {r.group ? (
                  <Link
                    href={`/${orgSlug}/groups/${r.group.slug}`}
                    onClick={(e) => e.stopPropagation()}
                  >
                    <Badge variant="default">{r.group.slug}</Badge>
                  </Link>
                ) : (
                  <span className="text-xs text-muted-foreground">—</span>
                )}
              </TableCell>
              <TableCell>
                <span className="flex flex-wrap gap-1">
                  {r.tags.map((t) => (
                    <Badge key={t} variant="outline">
                      {t}
                    </Badge>
                  ))}
                </span>
              </TableCell>
              <TableCell className="max-w-40 truncate text-xs text-muted-foreground">
                {r.createdBy}
              </TableCell>
              <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                {new Date(r.startedAt).toLocaleDateString()}
              </TableCell>
              <TableCell className="text-xs text-muted-foreground">
                {duration(r.startedAt, r.finishedAt)}
              </TableCell>
              {summaryKeys.map((k) => (
                <TableCell key={k} className="font-mono text-xs">
                  {r.summary[k] !== undefined
                    ? Number(r.summary[k]).toPrecision(4)
                    : "—"}
                </TableCell>
              ))}
            </TableRow>
          ))}
          {filtered.length === 0 && (
            <TableRow>
              <TableCell
                colSpan={9 + summaryKeys.length}
                className="py-8 text-center text-muted-foreground"
              >
                No runs match. Log one from a training script to get started.
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
      <p className="text-xs text-muted-foreground">
        Select 2–5 runs to compare, or bulk-tag/delete any selection.
      </p>
      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={(o) => {
          if (!o) setConfirmDelete(false);
        }}
        title={`Delete ${selected.length} runs?`}
        description="Metrics go with them; artifact history is kept. This cannot be undone."
        confirmLabel="Delete runs"
        busy={bulkBusy}
        onConfirm={() => void runBatch("delete")}
      />
    </div>
  );
}
