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
    { label: "Overview", href: `/${orgSlug}/${projectSlug}` },
    { label: "Runs", href: `/${orgSlug}/${projectSlug}/runs` },
  ];
  return (
    <nav className="flex gap-1 border-b border-border" aria-label="Project">
      {tabs.map((t) => {
        const active = pathname === t.href || pathname.startsWith(`${t.href}/`);
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
