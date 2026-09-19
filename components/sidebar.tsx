"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import * as React from "react";
import {
  FiChevronsLeft,
  FiChevronsRight,
  FiFolder,
  FiHome,
  FiKey,
  FiLayers,
  FiSettings,
  FiUsers,
} from "react-icons/fi";

import { UserMenu } from "@/components/user-menu";
import { cn } from "@/lib/utils";

const SECTIONS: {
  label: string;
  items: {
    href: string;
    label: string;
    icon: typeof FiFolder;
    admin?: boolean;
  }[];
}[] = [
  {
    label: "Home",
    items: [{ href: "dashboard", label: "Dashboard", icon: FiHome }],
  },
  {
    label: "Experiments",
    items: [
      { href: "projects", label: "Projects", icon: FiFolder },
      { href: "groups", label: "Groups", icon: FiLayers },
    ],
  },
  {
    label: "Management",
    items: [
      { href: "team", label: "Team", icon: FiUsers },
      { href: "settings/keys", label: "API Keys", icon: FiKey },
      { href: "settings", label: "Settings", icon: FiSettings, admin: true },
    ],
  },
];

// Embossed sidebar: flat items on warm paper, the active route pressed in
// like a molded key (inset shadow + deeper fill). Collapsible to icons.
export function Sidebar({
  orgSlug,
  orgName,
  email,
  displayName,
  role,
}: {
  orgSlug: string;
  orgName: string;
  email: string;
  displayName: string;
  role: "SUPER_ADMIN" | "MEMBER";
}) {
  const pathname = usePathname();
  // Lazy initializer (not an effect): reads persisted state once, and the
  // typeof guard keeps server prerendering safe. No setState-in-effect.
  const [collapsed, setCollapsed] = React.useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    try {
      return window.localStorage.getItem("cursus-sidebar") === "collapsed";
    } catch {
      return false;
    }
  });

  function toggle() {
    setCollapsed((c) => {
      try {
        window.localStorage.setItem(
          "cursus-sidebar",
          c ? "expanded" : "collapsed",
        );
      } catch {
        // Ignore persistence failures.
      }
      return !c;
    });
  }

  const isAdmin = role === "SUPER_ADMIN";

  return (
    <aside
      className={cn(
        "flex min-h-screen shrink-0 flex-col gap-1 border-r border-[#e5e2dc] bg-[#f1efeb] p-3 transition-[width] duration-200",
        collapsed ? "w-[68px]" : "w-60",
      )}
    >
      <div className="mb-3 flex items-center gap-2 px-1.5">
        <Image
          src="/cursos.svg"
          alt="Cursus"
          width={140}
          height={140}
          className="size-8 shrink-0"
        />
        {!collapsed && (
          <div className="min-w-0 flex-1">
            <p className="truncate text-[15px] font-bold tracking-tight text-neutral-900">
              Cursus
            </p>
            <p className="truncate text-[11px] text-neutral-500">{orgName}</p>
          </div>
        )}
        <button
          onClick={toggle}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          title={collapsed ? "Expand" : "Collapse"}
          className="ml-auto rounded-md p-1.5 text-white transition-colors bg-black/40 hover:bg-black/[0.05] hover:text-neutral-700"
        >
          {collapsed ? (
            <FiChevronsRight className="size-4" />
          ) : (
            <FiChevronsLeft className="size-4" />
          )}
        </button>
      </div>

      {SECTIONS.map((section) => {
        const visible = section.items.filter((i) => !i.admin || isAdmin);
        if (visible.length === 0) return null;
        return (
          <div key={section.label} className="flex flex-col gap-0.5">
            {!collapsed && (
              <p className="px-2.5 pb-1 pt-3 text-[10px] font-semibold uppercase tracking-[0.12em] text-neutral-400">
                {section.label}
              </p>
            )}
            {visible.map((item) => {
              const href = `/${orgSlug}/${item.href}`;
              // Exact match only: every sidebar destination is a leaf page,
              // so prefix matching would light up parents too (e.g. Settings
              // under settings/keys — the same bug project tabs once had).
              const active = pathname === href;
              return (
                <Link
                  key={item.href}
                  href={href}
                  title={collapsed ? item.label : undefined}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm transition-all",
                    collapsed && "justify-center px-0",
                    active
                      ? "bg-[#e4e1da] font-medium text-neutral-900 shadow-[inset_0_2px_5px_rgba(0,0,0,0.08),inset_0_-1px_0_rgba(255,255,255,0.7)]"
                      : "text-neutral-500 hover:bg-black/[0.045] hover:text-neutral-800",
                  )}
                >
                  <item.icon className="size-[18px] shrink-0" />
                  {!collapsed && item.label}
                </Link>
              );
            })}
          </div>
        );
      })}

      <div className="mt-auto flex flex-col gap-2 border-t border-[#e5e2dc] pt-3">
        <UserMenu
          email={email}
          displayName={displayName}
          role={role}
          profileHref={`/${orgSlug}/profile`}
          collapsed={collapsed}
        />
      </div>
    </aside>
  );
}
