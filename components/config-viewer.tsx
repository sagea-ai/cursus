import * as React from "react";

// Config tab: human-skimmable nested tree, not a raw JSON blob (§7.6).
export function ConfigViewer({ config }: { config: unknown }) {
  if (typeof config !== "object" || config === null) {
    return <code className="font-mono text-sm">{JSON.stringify(config)}</code>;
  }
  const entries = Object.entries(config as Record<string, unknown>);
  if (entries.length === 0) {
    return (
      <p className="py-4 text-center text-sm text-muted-foreground">
        No config logged for this run.
      </p>
    );
  }
  return (
    <dl className="overflow-hidden rounded-lg border border-border">
      {entries.map(([k, v], i) => (
        <div
          key={k}
          className={`grid grid-cols-[220px_1fr] gap-4 px-4 py-2.5 text-sm ${i % 2 === 0 ? "bg-card" : "bg-muted/40"}`}
        >
          <dt className="truncate font-mono text-xs text-muted-foreground">
            {k}
          </dt>
          <dd className="font-mono text-xs">
            {typeof v === "object" && v !== null ? (
              <details>
                <summary className="cursor-pointer text-accent-pale">
                  {Array.isArray(v) ? `array[${v.length}]` : "object"}
                </summary>
                <pre className="mt-1 overflow-x-auto whitespace-pre-wrap">
                  {JSON.stringify(v, null, 2)}
                </pre>
              </details>
            ) : (
              String(v)
            )}
          </dd>
        </div>
      ))}
    </dl>
  );
}
