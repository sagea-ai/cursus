"use client";

import Link from "next/link";
import * as React from "react";
import { FiBox } from "react-icons/fi";

import { DeleteProjectButton } from "@/components/delete-project-button";
import { Badge } from "@/components/ui/badge";
import { StatusBadge } from "@/components/status-badge";
import { Input } from "@/components/ui/input";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { ProjectSummary } from "@/lib/projects";

function timeAgo(d: Date | null): string {
  if (!d) return "never";
  const s = Math.floor((Date.now() - new Date(d).getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

// Project grid with client-side search. Each card is entirely clickable via
// a stretched overlay link; the admin delete button floats above it so the
// two never compete (no nested buttons).
export function ProjectGrid({
  projects,
  orgSlug,
  isAdmin,
}: {
  projects: ProjectSummary[];
  orgSlug: string;
  isAdmin: boolean;
}) {
  const [query, setQuery] = React.useState("");
  const filtered = projects.filter((p) =>
    p.name.toLowerCase().includes(query.trim().toLowerCase()),
  );

  return (
    <div className="flex flex-col gap-4">
      {projects.length > 4 && (
        <Input
          placeholder="Search projects…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="max-w-xs"
          aria-label="Search projects"
        />
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        {filtered.map((p) => (
          <Card
            key={p.id}
            className="relative transition-colors hover:shadow-md focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2 focus-within:ring-offset-background"
          >
            <Link
              href={`/${orgSlug}/${p.slug}`}
              aria-label={`Open project ${p.name}`}
              className="before:absolute before:inset-0 before:rounded-lg before:content-['']"
            />
            <CardHeader>
              <CardTitle className="flex items-center gap-2 pr-8 text-base">
                <FiBox className="size-4 shrink-0 text-accent-soft" />
                <span className="min-w-0 flex-1 truncate">{p.name}</span>
              </CardTitle>
              <CardDescription>
                {p.runCount} run{p.runCount === 1 ? "" : "s"} · active{" "}
                {timeAgo(p.lastRunAt ? new Date(p.lastRunAt) : null)}
              </CardDescription>
            </CardHeader>
            {(Object.keys(p.statusCounts).length > 0 || isAdmin) && (
              <CardContent className="flex flex-wrap items-center gap-1.5">
                {Object.entries(p.statusCounts).map(([status, n]) => (
                  <span key={status} className="flex items-center gap-1.5">
                    <StatusBadge status={status} />
                    <Badge variant="outline">{n}</Badge>
                  </span>
                ))}
                {isAdmin && (
                  <span className="relative z-10 ml-auto">
                    <DeleteProjectButton
                      orgSlug={orgSlug}
                      projectSlug={p.slug}
                      projectName={p.name}
                    />
                  </span>
                )}
              </CardContent>
            )}
          </Card>
        ))}
      </div>
      {filtered.length === 0 && (
        <p className="py-8 text-center text-sm text-muted-foreground">
          No projects match “{query}”.
        </p>
      )}
    </div>
  );
}
