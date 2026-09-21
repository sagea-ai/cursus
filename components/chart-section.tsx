"use client";

import * as React from "react";
import { FiChevronDown, FiChevronRight } from "react-icons/fi";

import { cn } from "@/lib/utils";

// Collapsible chart section (W&B-style panel groups): header with chevron,
// mono title, and item count; collapsed content unmounts so hidden charts
// cost nothing (overlays fetch lazily on first expand). Controlled when
// open/onToggle are given, uncontrolled otherwise. In-memory state only
// (no persistence — hydration-safe).
export function ChartSection({
  title,
  count,
  defaultOpen = true,
  open,
  onToggle,
  actions,
  children,
}: {
  title: string;
  count?: number;
  defaultOpen?: boolean;
  open?: boolean;
  onToggle?: () => void;
  actions?: React.ReactNode;
  children: React.ReactNode;
}) {
  const [inner, setInner] = React.useState(defaultOpen);
  const isOpen = open ?? inner;
  const toggle = onToggle ?? (() => setInner((o) => !o));
  return (
    <section className="flex flex-col gap-3 rounded-md border border-border bg-card">
      <div className="flex items-center gap-2 px-3 py-2">
        <button
          onClick={toggle}
          aria-expanded={isOpen}
          aria-label={`${isOpen ? "Collapse" : "Expand"} ${title} section`}
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
        >
          <span className="text-muted-foreground">
            {isOpen ? (
              <FiChevronDown className="size-4" />
            ) : (
              <FiChevronRight className="size-4" />
            )}
          </span>
          <span className="truncate font-mono text-xs uppercase tracking-wider text-muted-foreground">
            {title}
          </span>
          {count !== undefined && (
            <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground">
              {count}
            </span>
          )}
        </button>
        {actions && <span className="flex shrink-0 gap-1">{actions}</span>}
      </div>
      <div className={cn("px-3 pb-3", !isOpen && "hidden")}>
        {isOpen && children}
      </div>
    </section>
  );
}
