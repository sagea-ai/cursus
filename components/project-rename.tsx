"use client";

import { useRouter } from "next/navigation";
import * as React from "react";
import { FiCheck, FiEdit2, FiX } from "react-icons/fi";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function ProjectRename({
  orgSlug,
  projectSlug,
  initialName,
}: {
  orgSlug: string;
  projectSlug: string;
  initialName: string;
}) {
  const router = useRouter();
  const [editing, setEditing] = React.useState(false);
  const [name, setName] = React.useState(initialName);
  const [error, setError] = React.useState<string | null>(null);

  async function save() {
    const trimmed = name.trim();
    if (!trimmed || trimmed === initialName) {
      setName(initialName);
      setEditing(false);
      return;
    }
    setError(null);
    const res = await fetch(`/api/v1/orgs/${orgSlug}/projects/${projectSlug}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: trimmed }),
    });
    if (!res.ok) {
      const body = await res.json();
      setError(body.error ?? "Rename failed");
      return;
    }
    setEditing(false);
    router.refresh();
  }

  if (!editing) {
    return (
      <span className="flex items-center gap-1.5">
        <h1 className="text-2xl font-semibold">{initialName}</h1>
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setEditing(true)}
          aria-label="Rename project"
          title="Rename project"
        >
          <FiEdit2 />
        </Button>
      </span>
    );
  }
  return (
    <span className="flex flex-col gap-1">
      <span className="flex items-center gap-1.5">
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void save();
            if (e.key === "Escape") {
              setName(initialName);
              setEditing(false);
            }
          }}
          className="h-8 w-64"
          autoFocus
          aria-label="Project name"
        />
        <Button
          variant="ghost"
          size="icon"
          onClick={() => void save()}
          aria-label="Save project name"
        >
          <FiCheck />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          onClick={() => {
            setName(initialName);
            setEditing(false);
          }}
          aria-label="Cancel rename"
        >
          <FiX />
        </Button>
      </span>
      {error && (
        <span role="alert" className="text-sm text-warning">
          {error}
        </span>
      )}
    </span>
  );
}
