"use client";

import Link from "next/link";
import * as React from "react";

import { DeleteGroupButton } from "@/components/delete-group-button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { GroupSummary } from "@/lib/groups";

// Dense groups table mirroring the projects table: search, counts, and
// admin row actions.
export function GroupsTable({
  groups,
  orgSlug,
  isAdmin,
}: {
  groups: GroupSummary[];
  orgSlug: string;
  isAdmin: boolean;
}) {
  const [query, setQuery] = React.useState("");
  const filtered = groups.filter((g) =>
    `${g.name} ${g.slug}`.toLowerCase().includes(query.trim().toLowerCase()),
  );

  return (
    <div className="flex flex-col gap-3">
      <Input
        placeholder="Search by group name"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        aria-label="Search groups"
        className="max-w-md"
      />
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>Description</TableHead>
            <TableHead className="text-right">Members</TableHead>
            <TableHead className="text-right">Projects</TableHead>
            <TableHead className="text-right">Runs</TableHead>
            {isAdmin && <TableHead className="w-16" />}
          </TableRow>
        </TableHeader>
        <TableBody>
          {filtered.map((g) => (
            <TableRow key={g.id}>
              <TableCell>
                <Link
                  href={`/${orgSlug}/groups/${g.slug}`}
                  className="font-medium text-accent-pale hover:underline"
                >
                  {g.name}
                </Link>
              </TableCell>
              <TableCell className="max-w-64 truncate text-xs text-muted-foreground">
                {g.description || "—"}
              </TableCell>
              <TableCell className="text-right font-mono text-xs">
                {g.memberCount}
              </TableCell>
              <TableCell className="text-right font-mono text-xs">
                {g.projectCount}
              </TableCell>
              <TableCell className="text-right font-mono text-xs">
                {g.runCount}
              </TableCell>
              {isAdmin && (
                <TableCell>
                  <DeleteGroupButton groupSlug={g.slug} groupName={g.name} />
                </TableCell>
              )}
            </TableRow>
          ))}
          {filtered.length === 0 && (
            <TableRow>
              <TableCell
                colSpan={isAdmin ? 6 : 5}
                className="py-8 text-center text-muted-foreground"
              >
                {groups.length === 0
                  ? "No groups yet."
                  : `No groups match “${query}”.`}
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  );
}
