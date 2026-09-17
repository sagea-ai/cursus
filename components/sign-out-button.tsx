"use client";

import { useRouter } from "next/navigation";
import * as React from "react";
import { FiLogOut } from "react-icons/fi";

import { Button } from "@/components/ui/button";

export function SignOutButton({ email }: { email: string }) {
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
      <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
        {email}
      </span>
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
