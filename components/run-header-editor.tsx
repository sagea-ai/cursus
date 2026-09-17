"use client";

import { useRouter } from "next/navigation";
import * as React from "react";
import { FiCheck, FiEdit2, FiPlus, FiTrash2, FiX } from "react-icons/fi";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

// Inline run rename + tag editing (§7.6) and admin delete. PATCH/DELETE
// /api/v1/runs/:id, then router.refresh() to re-render the server page.
export function RunHeaderEditor({
  runId,
  initialName,
  initialTags,
  isAdmin,
  runsPath,
}: {
  runId: string;
  initialName: string;
  initialTags: string[];
  isAdmin: boolean;
  runsPath: string;
}) {
  const router = useRouter();
  const [name, setName] = React.useState(initialName);
  const [editingName, setEditingName] = React.useState(false);
  const [tags, setTags] = React.useState(initialTags);
  const [newTag, setNewTag] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);

  async function patch(body: { name?: string; tags?: string[] }) {
    setError(null);
    const res = await fetch(`/api/v1/runs/${runId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const data = await res.json();
      setError(data.error ?? "Update failed");
      return false;
    }
    router.refresh();
    return true;
  }

  async function saveName() {
    const trimmed = name.trim();
    if (!trimmed || trimmed === initialName) {
      setName(initialName);
      setEditingName(false);
      return;
    }
    if (await patch({ name: trimmed })) setEditingName(false);
  }

  async function addTag(e: React.FormEvent) {
    e.preventDefault();
    const t = newTag.trim();
    if (!t || tags.includes(t)) return;
    const next = [...tags, t];
    setTags(next);
    setNewTag("");
    if (!(await patch({ tags: next }))) setTags(initialTags);
  }

  async function removeTag(t: string) {
    const next = tags.filter((x) => x !== t);
    setTags(next);
    if (!(await patch({ tags: next }))) setTags(initialTags);
  }

  async function removeRun() {
    if (
      !confirm(
        `Delete run "${initialName}" and all its metrics? This cannot be undone.`,
      )
    ) {
      return;
    }
    const res = await fetch(`/api/v1/runs/${runId}`, { method: "DELETE" });
    if (!res.ok) {
      const data = await res.json();
      alert(data.error ?? "Delete failed");
      return;
    }
    router.push(runsPath);
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        {editingName ? (
          <span className="flex items-center gap-1.5">
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void saveName();
                if (e.key === "Escape") {
                  setName(initialName);
                  setEditingName(false);
                }
              }}
              className="h-8 w-64"
              autoFocus
              aria-label="Run name"
            />
            <Button
              variant="ghost"
              size="icon"
              onClick={() => void saveName()}
              aria-label="Save name"
            >
              <FiCheck />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => {
                setName(initialName);
                setEditingName(false);
              }}
              aria-label="Cancel rename"
            >
              <FiX />
            </Button>
          </span>
        ) : (
          <span className="flex items-center gap-1.5">
            <h1 className="text-2xl font-semibold">{initialName}</h1>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setEditingName(true)}
              aria-label="Rename run"
              title="Rename run"
            >
              <FiEdit2 />
            </Button>
          </span>
        )}
        {isAdmin && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void removeRun()}
            aria-label="Delete run"
            className="text-warning"
          >
            <FiTrash2 /> Delete
          </Button>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        {tags.map((t) => (
          <Badge key={t} variant="outline" className="gap-1">
            {t}
            <button
              onClick={() => void removeTag(t)}
              aria-label={`Remove tag ${t}`}
              className="opacity-60 hover:opacity-100"
            >
              <FiX className="size-3" />
            </button>
          </Badge>
        ))}
        <form onSubmit={addTag} className="flex items-center gap-1">
          <Input
            value={newTag}
            onChange={(e) => setNewTag(e.target.value)}
            placeholder="add tag"
            aria-label="Add tag"
            className="h-7 w-28 text-xs"
          />
          <Button
            variant="ghost"
            size="icon"
            className="size-7"
            aria-label="Add tag"
          >
            <FiPlus />
          </Button>
        </form>
      </div>
      {error && (
        <p role="alert" className="text-sm text-warning">
          {error}
        </p>
      )}
    </div>
  );
}
