"use client";

import * as React from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export interface RunLogLine {
  id: string;
  stream: string;
  step: number | null;
  text: string;
  wallTime: string;
}

// Terminal-style log viewer: newest tail first, stream filter, load-older
// pagination against the cursor API. Pure rendering — all data arrives via
// props or the page's fetches below.
export function RunLogs({
  runId,
  initial,
}: {
  runId: string;
  initial: { lines: RunLogLine[]; total: number; nextCursor: string | null };
}) {
  const [stream, setStream] = React.useState<"all" | "stdout" | "stderr">(
    "all",
  );
  const [lines, setLines] = React.useState(initial.lines);
  const [cursor, setCursor] = React.useState(initial.nextCursor);
  const [total, setTotal] = React.useState(initial.total);
  const [loading, setLoading] = React.useState(false);

  async function loadOlder() {
    if (!cursor || loading) return;
    setLoading(true);
    const params = new URLSearchParams({ cursor, limit: "500" });
    if (stream !== "all") params.set("stream", stream);
    const res = await fetch(`/api/v1/runs/${runId}/logs?${params.toString()}`);
    setLoading(false);
    if (!res.ok) return;
    const page = (await res.json()) as {
      lines: RunLogLine[];
      total: number;
      nextCursor: string | null;
    };
    // Older lines prepend (list stays chronological).
    setLines((prev) => [...page.lines, ...prev]);
    setCursor(page.nextCursor);
    setTotal(page.total);
  }

  async function setFilter(next: "all" | "stdout" | "stderr") {
    setStream(next);
    setLoading(true);
    const params = new URLSearchParams({ limit: "500" });
    if (next !== "all") params.set("stream", next);
    const res = await fetch(`/api/v1/runs/${runId}/logs?${params.toString()}`);
    setLoading(false);
    if (!res.ok) return;
    const page = (await res.json()) as {
      lines: RunLogLine[];
      total: number;
      nextCursor: string | null;
    };
    setLines(page.lines);
    setCursor(page.nextCursor);
    setTotal(page.total);
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        {(["all", "stdout", "stderr"] as const).map((s) => (
          <Button
            key={s}
            variant={stream === s ? "default" : "ghost"}
            size="sm"
            onClick={() => void setFilter(s)}
          >
            {s === "all" ? "All" : s}
          </Button>
        ))}
        <span className="ml-auto text-xs text-muted-foreground">
          showing {lines.length} of {total}
        </span>
      </div>
      {lines.length === 0 ? (
        <p className="rounded-md border border-border p-5 text-sm text-muted-foreground">
          No log lines yet — capture stdout with{" "}
          <code className="font-mono">cursus.log_text(...)</code>.
        </p>
      ) : (
        <pre className="max-h-[480px] overflow-auto rounded-md bg-black p-4 font-mono text-xs leading-relaxed text-neutral-200">
          {lines.map((line) => (
            <div key={line.id} className="flex gap-2">
              <span
                className={cn(
                  "w-14 shrink-0 select-none text-right",
                  line.stream === "stderr"
                    ? "text-red-400"
                    : "text-neutral-500",
                )}
              >
                {line.stream === "stderr" ? "stderr" : (line.step ?? "")}
              </span>
              <span className="whitespace-pre-wrap break-all">{line.text}</span>
            </div>
          ))}
        </pre>
      )}
      {cursor && (
        <div>
          <Button
            variant="secondary"
            size="sm"
            disabled={loading}
            onClick={() => void loadOlder()}
          >
            {loading ? "Loading…" : "Load older lines"}
          </Button>
        </div>
      )}
    </div>
  );
}
