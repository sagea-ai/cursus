"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/utils";

// Project-level tabs mirroring the runs/compare structure: Overview | Runs.
export function ProjectTabs({
  orgSlug,
  projectSlug,
}: {
  orgSlug: string;
  projectSlug: string;
}) {
  const pathname = usePathname();
  const tabs = [
    { label: "Overview", href: `/${orgSlug}/${projectSlug}`, exact: true },
    { label: "Runs", href: `/${orgSlug}/${projectSlug}/runs`, exact: false },
    {
      label: "Workspace",
      href: `/${orgSlug}/${projectSlug}/workspace`,
      exact: false,
    },
    {
      label: "Artifacts",
      href: `/${orgSlug}/${projectSlug}/artifacts`,
      exact: false,
    },
    {
      label: "Sweeps",
      href: `/${orgSlug}/${projectSlug}/sweeps`,
      exact: false,
    },
  ];
  return (
    <nav className="flex gap-1 border-b border-border" aria-label="Project">
      {tabs.map((t) => {
        // Overview matches exactly: it prefixes every project URL, so
        // prefix-matching would leave it highlighted on Runs/Artifacts too.
        const active = t.exact
          ? pathname === t.href
          : pathname === t.href || pathname.startsWith(`${t.href}/`);
        return (
          <Link
            key={t.href}
            href={t.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "-mb-px border-b-2 px-3 py-2 text-sm transition-colors",
              active
                ? "border-primary font-medium text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
