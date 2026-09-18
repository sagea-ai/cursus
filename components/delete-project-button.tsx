"use client";

import { useRouter } from "next/navigation";
import * as React from "react";
import { FiTrash2 } from "react-icons/fi";

import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/confirm-dialog";

export function DeleteProjectButton({
  orgSlug,
  projectSlug,
  projectName,
}: {
  orgSlug: string;
  projectSlug: string;
  projectName: string;
}) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function runDelete() {
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/v1/orgs/${orgSlug}/projects/${projectSlug}`, {
      method: "DELETE",
    });
    setBusy(false);
    if (!res.ok) {
      const body = await res.json();
      setError(body.error ?? "Delete failed");
      return;
    }
    setOpen(false);
    router.refresh();
  }

  return (
    <>
      <Button
        variant="ghost"
        size="icon"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setError(null);
          setOpen(true);
        }}
        aria-label={`Delete project ${projectName}`}
        title="Delete project (super admin)"
        className="text-warning"
      >
        <FiTrash2 />
      </Button>
      <ConfirmDialog
        open={open}
        onOpenChange={(o) => {
          if (!o) setOpen(false);
        }}
        title="Delete project"
        description={`Delete project "${projectName}" and ALL its runs and metrics? This cannot be undone.`}
        confirmLabel="Delete project"
        busy={busy}
        onConfirm={() => void runDelete()}
      />
      {error && (
        <span role="alert" className="text-xs text-warning">
          {error}
        </span>
      )}
    </>
  );
}
