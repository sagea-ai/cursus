"use client";

import { useRouter } from "next/navigation";
import { FiTrash2 } from "react-icons/fi";

import { Button } from "@/components/ui/button";

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

  async function onDelete(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (
      !confirm(
        `Delete project "${projectName}" and ALL its runs and metrics? This cannot be undone.`,
      )
    ) {
      return;
    }
    const res = await fetch(`/api/v1/orgs/${orgSlug}/projects/${projectSlug}`, {
      method: "DELETE",
    });
    if (!res.ok) {
      const body = await res.json();
      alert(body.error ?? "Delete failed");
      return;
    }
    router.refresh();
  }

  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={onDelete}
      aria-label={`Delete project ${projectName}`}
      title="Delete project (super admin)"
      className="text-warning"
    >
      <FiTrash2 />
    </Button>
  );
}
