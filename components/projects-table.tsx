"use client";

import Link from "next/link";
import * as React from "react";
import { FiStar } from "react-icons/fi";

import { DeleteProjectButton } from "@/components/delete-project-button";
import { StatusBadge } from "@/components/status-badge";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { ProjectSummary } from "@/lib/projects";

function timeAgo(d: Date | string | null): string {
  if (!d) return "—";
  const t = new Date(d).getTime();
  const s = Math.max(0, Math.floor((Date.now() - t) / 1000));
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  const days = Math.floor(s / 86400);
  if (days < 30) return `${days}d ago`;
  return new Date(t).toLocaleDateString();
}

// Dense project table (W&B-style): search, visibility, run counts, status
// mix, and admin row actions. Replaces the card grid.
export function ProjectsTable({
  projects,
  orgSlug,
  isAdmin,
}: {
  projects: ProjectSummary[];
  orgSlug: string;
  isAdmin: boolean;
}) {
  const [query, setQuery] = React.useState("");
  const [starred, setStarred] = React.useState<string[]>([]);
  const filtered = projects.filter((p) =>
    `${p.name} ${p.slug}`.toLowerCase().includes(query.trim().toLowerCase()),
  );
  const sorted = [...filtered].sort((a, b) => {
    const sa = starred.includes(a.id) ? 0 : 1;
    const sb = starred.includes(b.id) ? 0 : 1;
    return sa - sb;
  });

  function toggleStar(id: string) {
    setStarred((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <Input
        placeholder="Search by project name"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        aria-label="Search projects"
        className="max-w-md"
      />
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>Last active</TableHead>
            <TableHead>Visibility</TableHead>
            <TableHead className="text-right">Runs</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="w-20" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {sorted.map((p) => (
            <TableRow key={p.id}>
              <TableCell>
                <Link
                  href={`/${orgSlug}/${p.slug}`}
                  className="font-medium text-accent-pale hover:underline"
                >
                  {p.name}
                </Link>
              </TableCell>
              <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                {timeAgo(p.lastRunAt)}
              </TableCell>
              <TableCell>
                {p.group ? (
                  <Link href={`/${orgSlug}/groups/${p.group.slug}`}>
                    <Badge variant="default">{p.group.slug}</Badge>
                  </Link>
                ) : (
                  <Badge variant="secondary">Org-wide</Badge>
                )}
              </TableCell>
              <TableCell className="text-right font-mono text-xs">
                {p.runCount}
              </TableCell>
              <TableCell>
                <span className="flex flex-wrap gap-1">
                  {Object.keys(p.statusCounts).length === 0 ? (
                    <span className="text-xs text-muted-foreground">—</span>
                  ) : (
                    Object.entries(p.statusCounts).map(([status, n]) => (
                      <span
                        key={status}
                        className="flex items-center gap-1"
                        title={`${n} ${status.toLowerCase()}`}
                      >
                        <StatusBadge status={status} />
                      </span>
                    ))
                  )}
                </span>
              </TableCell>
              <TableCell>
                <span className="flex items-center justify-end gap-0.5">
                  <button
                    onClick={() => toggleStar(p.id)}
                    aria-label={starred.includes(p.id) ? `Unstar ${p.name}` : `Star ${p.name}`}
                    aria-pressed={starred.includes(p.id)}
                    className={
                      starred.includes(p.id)
                        ? "rounded p-1.5 text-warning"
                        : "rounded p-1.5 text-muted-foreground hover:text-foreground"
                    }
                  >
                    <FiStar
                      className="size-4"
                      fill={starred.includes(p.id) ? "currentColor" : "none"}
                    />
                  </button>
                  {isAdmin && (
                    <DeleteProjectButton
                      orgSlug={orgSlug}
                      projectSlug={p.slug}
                      projectName={p.name}
                    />
                  )}
                </span>
              </TableCell>
            </TableRow>
          ))}
          {sorted.length === 0 && (
            <TableRow>
              <TableCell
                colSpan={6}
                className="py-8 text-center text-muted-foreground"
              >
                {projects.length === 0
                  ? "No projects yet."
                  : `No projects match “${query}”.`}
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  );
}
