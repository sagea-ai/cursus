"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import * as React from "react";
import { FiLogOut, FiUser } from "react-icons/fi";

import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

// Sidebar account footer: identity opens the profile menu; a dedicated
// sign-out icon signs out in one click (no menu digging).
export function UserMenu({
  email,
  displayName,
  role,
  profileHref,
  collapsed,
}: {
  email: string;
  displayName: string;
  role: "SUPER_ADMIN" | "MEMBER";
  profileHref: string;
  collapsed: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = React.useState(false);
  const initial = (displayName || email).charAt(0).toUpperCase();

  async function signOut() {
    setBusy(true);
    await fetch("/api/v1/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  }

  return (
    <div
      className={
        collapsed
          ? "flex flex-col items-center gap-1"
          : "flex items-center gap-1"
      }
    >
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          {collapsed ? (
            <button
              aria-label={`Account: ${displayName}`}
              title={`${displayName} (${email})`}
              className="mx-auto flex size-8 items-center justify-center rounded-full bg-primary/15 text-xs font-semibold text-primary-ink outline-none hover:bg-primary/25 focus-visible:ring-2 focus-visible:ring-ring"
            >
              {initial}
            </button>
          ) : (
            <button
              aria-label={`Account: ${displayName}`}
              className="flex min-w-0 flex-1 items-center gap-2 rounded-md px-1 py-1 text-left outline-none transition-colors hover:bg-black/[0.04] focus-visible:ring-2 focus-visible:ring-ring"
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate text-xs font-medium">
                  {displayName}
                </span>
                <span className="block truncate text-[11px] text-muted-foreground">
                  {email}
                </span>
              </span>
            </button>
          )}
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align={collapsed ? "center" : "start"}
          side="top"
          className="w-60"
        >
          <DropdownMenuLabel>
            <span className="flex items-center gap-2.5">
              <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary/15 text-sm font-semibold text-primary-ink">
                {initial}
              </span>
              <span className="min-w-0">
                <span className="block truncate text-sm font-medium">
                  {displayName}
                </span>
                <span className="block truncate text-xs font-normal text-muted-foreground">
                  {email}
                </span>
              </span>
            </span>
            <span className="mt-2 block">
              <Badge variant="secondary">
                {role === "SUPER_ADMIN" ? "Super Admin" : "Member"}
              </Badge>
            </span>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem asChild>
            <Link href={profileHref} className="cursor-pointer">
              <FiUser /> View profile
            </Link>
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() => void signOut()}
            disabled={busy}
            className="cursor-pointer"
          >
            <FiLogOut /> {busy ? "Signing out…" : "Sign out"}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <button
        onClick={() => void signOut()}
        disabled={busy}
        aria-label="Sign out"
        title="Sign out"
        className="shrink-0 rounded-md p-1.5 text-neutral-500 transition-colors hover:bg-black/[0.05] hover:text-neutral-800 disabled:opacity-50"
      >
        <FiLogOut className="size-4" />
      </button>
    </div>
  );
}
