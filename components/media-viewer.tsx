"use client";

import * as React from "react";

import { cn } from "@/lib/utils";

export interface MediaViewerStep {
  id: string;
  step: number;
  url: string;
}

// Step-scrubbable image viewer: one image at a time plus a thumbnail strip
// (server presigns the URLs; this component only renders + scrubs).
export function MediaViewer({
  mediaKey,
  steps,
}: {
  mediaKey: string;
  steps: MediaViewerStep[];
}) {
  const [index, setIndex] = React.useState(0);
  const current = steps[Math.min(index, steps.length - 1)];
  if (!current) return null;
  return (
    <div className="flex flex-col gap-2">
      <p className="font-mono text-xs text-muted-foreground">{mediaKey}</p>
      <div className="flex min-h-48 items-center justify-center overflow-hidden rounded-md border border-border bg-black">
        {/* Direct storage URL (presigned, 15 min) — the browser fetches
            bytes from object storage, never through Next.js. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={current.url}
          alt={`${mediaKey} at step ${current.step}`}
          className="max-h-96 object-contain"
        />
      </div>
      <div className="flex items-center gap-3">
        <input
          type="range"
          min={0}
          max={steps.length - 1}
          value={Math.min(index, steps.length - 1)}
          onChange={(e) => setIndex(Number(e.target.value))}
          aria-label={`Step scrubber for ${mediaKey}`}
          className="flex-1"
        />
        <span className="w-20 shrink-0 text-right font-mono text-xs text-muted-foreground">
          step {current.step}
        </span>
      </div>
      {steps.length > 1 && (
        <div className="flex gap-1.5 overflow-x-auto pb-1">
          {steps.map((s, i) => (
            <button
              key={s.id}
              onClick={() => setIndex(i)}
              aria-label={`Show step ${s.step}`}
              className={cn(
                "h-12 w-12 shrink-0 overflow-hidden rounded border",
                i === Math.min(index, steps.length - 1)
                  ? "border-accent-pale"
                  : "border-border opacity-60 hover:opacity-100",
              )}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={s.url}
                alt=""
                loading="lazy"
                className="h-full w-full object-cover"
              />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
