"use client";

import * as React from "react";
import { FiCheck, FiCopy } from "react-icons/fi";

import { Button } from "@/components/ui/button";

// One-click copy for single values (URLs, commands). For code samples with
// highlighting, use CodeBlock (it has its own copy button).
export function CopyButton({
  text,
  label = "Copy",
  copiedLabel = "Copied",
}: {
  text: string;
  label?: string;
  copiedLabel?: string;
}) {
  const [copied, setCopied] = React.useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const area = document.createElement("textarea");
      area.value = text;
      document.body.appendChild(area);
      area.select();
      document.execCommand("copy");
      document.body.removeChild(area);
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  }

  return (
    <Button
      variant="secondary"
      size="sm"
      onClick={() => void copy()}
      aria-label={copied ? copiedLabel : label}
    >
      {copied ? <FiCheck /> : <FiCopy />} {copied ? copiedLabel : label}
    </Button>
  );
}
