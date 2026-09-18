"use client";

import { FiDownload } from "react-icons/fi";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

// Same-origin download links carry the session cookie — no fetch needed.
export function ExportMenu({ runId }: { runId: string }) {
  function download(format: "csv" | "json") {
    window.location.href = `/api/v1/runs/${runId}/export?format=${format}`;
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="secondary" size="sm" aria-label="Export metrics">
          <FiDownload /> Export
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>Download all logged points</DropdownMenuLabel>
        <DropdownMenuItem onClick={() => download("csv")}>
          CSV (spreadsheet)
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => download("json")}>
          JSON
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
