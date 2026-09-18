"use client";

import { useRouter } from "next/navigation";
import { FiTrash2 } from "react-icons/fi";

import { Button } from "@/components/ui/button";

export function DeleteGroupButton({
  groupSlug,
  groupName,
}: {
  groupSlug: string;
  groupName: string;
}) {
  const router = useRouter();

  async function onDelete(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (
      !confirm(
        `Delete group "${groupName}"? Its projects become org-wide; members, runs, and history are kept.`,
      )
    ) {
      return;
    }
    const res = await fetch(`/api/v1/groups/${groupSlug}`, {
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
      aria-label={`Delete group ${groupName}`}
      title="Delete group (super admin)"
      className="text-warning"
    >
      <FiTrash2 />
    </Button>
  );
}
