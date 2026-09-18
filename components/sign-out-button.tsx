"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import * as React from "react";
import { FiLogOut } from "react-icons/fi";

import { Button } from "@/components/ui/button";

export function SignOutButton({
  email,
  name,
  profileHref,
}: {
  email: string;
  name: string;
  profileHref: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = React.useState(false);

  async function signOut() {
    setBusy(true);
    await fetch("/api/v1/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  }

  return (
    <div className="flex items-center gap-2">
      <Link
        href={profileHref}
        className="min-w-0 flex-1 rounded-md hover:bg-black/[0.04]"
        title="View profile"
      >
        <span className="block truncate text-xs font-medium">{name}</span>
        <span className="block truncate text-[11px] text-muted-foreground">
          {email}
        </span>
      </Link>
      <Button
        variant="ghost"
        size="icon"
        onClick={signOut}
        disabled={busy}
        title="Sign out"
        aria-label="Sign out"
      >
        <FiLogOut />
      </Button>
    </div>
  );
}
