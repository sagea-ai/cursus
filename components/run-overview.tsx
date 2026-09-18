"use client";

import * as React from "react";
import { FiCheck, FiCopy } from "react-icons/fi";

import { Button } from "@/components/ui/button";

import Link from "next/link";

// Run Overview tab: identity, lifecycle, produced artifacts, and the
// free-text notes field (the table's NOTES column edits here).
export function RunOverview({
  runId,
  runPath,
  status,
  createdBy,
  startedAt,
  finishedAt,
  initialNotes,
  artifactsBasePath,
  producedArtifacts,
}: {
  runId: string;
  runPath: string;
  status: string;
  createdBy: string;
  startedAt: string;
  finishedAt: string | null;
  initialNotes: string;
  artifactsBasePath: string;
  producedArtifacts: { artifactName: string; version: number }[];
}) {
  const [notes, setNotes] = React.useState(initialNotes);
  const [saved, setSaved] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [copied, setCopied] = React.useState(false);

  async function save() {
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/v1/runs/${runId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ notes }),
    });
    setBusy(false);
    if (!res.ok) {
      const body = await res.json();
      setError(body.error ?? "Could not save notes");
      return;
    }
    setSaved(true);
  }

  const rows: [string, React.ReactNode][] = [
    [
      "Run path",
      <span key="path" className="flex items-center gap-1.5">
        <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">
          {runPath}
        </code>
        <Button
          variant="ghost"
          size="icon"
          className="size-6"
          aria-label="Copy run path"
          onClick={() => {
            void navigator.clipboard.writeText(runPath);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          }}
        >
          {copied ? <FiCheck /> : <FiCopy />}
        </Button>
      </span>,
    ],
    ["Status", <span key="status">{status.toLowerCase()}</span>],
    ["Created by", <span key="by">{createdBy}</span>],
    [
      "Started",
      <span key="start">{new Date(startedAt).toLocaleString()}</span>,
    ],
    [
      "Finished",
      <span key="fin">
        {finishedAt
          ? new Date(finishedAt).toLocaleString()
          : "— (still running)"}
      </span>,
    ],
    [
      "Artifacts",
      <span key="art">
        {producedArtifacts.length === 0 ? (
          "—"
        ) : (
          <span className="flex flex-wrap gap-1.5">
            {producedArtifacts.map((a) => (
              <Link
                key={`${a.artifactName}-v${a.version}`}
                href={`${artifactsBasePath}/${encodeURIComponent(a.artifactName)}?v=${a.version}`}
                className="font-mono text-xs text-accent-pale hover:underline"
              >
                {a.artifactName}:v{a.version}
              </Link>
            ))}
          </span>
        )}
      </span>,
    ],
  ];

  return (
    <div className="flex max-w-3xl flex-col gap-5">
      <dl className="overflow-hidden rounded-lg border border-border">
        {rows.map(([label, value], i) => (
          <div
            key={label}
            className={`grid grid-cols-[160px_1fr] gap-4 px-4 py-2.5 text-sm ${i % 2 === 0 ? "bg-card" : "bg-muted/40"}`}
          >
            <dt className="text-muted-foreground">{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>

      <div className="flex flex-col gap-2">
        <label htmlFor="run-notes" className="text-sm font-medium">
          Notes
        </label>
        <textarea
          id="run-notes"
          value={notes}
          onChange={(e) => {
            setNotes(e.target.value);
            setSaved(false);
          }}
          rows={3}
          maxLength={2000}
          placeholder="What was this run trying? What did you learn?"
          className="w-full rounded-md border border-input bg-card px-3 py-2 text-sm shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            disabled={busy || saved}
            onClick={() => void save()}
          >
            {busy ? "Saving…" : saved ? "Saved" : "Save notes"}
          </Button>
          {error && (
            <p role="alert" className="text-sm text-warning">
              {error}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
