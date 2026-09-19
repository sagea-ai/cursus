"use client";

import * as React from "react";
import { FiCheck, FiCopy } from "react-icons/fi";
import { PrismLight as SyntaxHighlighter } from "react-syntax-highlighter";
import bash from "react-syntax-highlighter/dist/esm/languages/prism/bash";
import python from "react-syntax-highlighter/dist/esm/languages/prism/python";
import { oneDark } from "react-syntax-highlighter/dist/esm/styles/prism";

SyntaxHighlighter.registerLanguage("python", python);
SyntaxHighlighter.registerLanguage("bash", bash);

type SupportedLanguage = "python" | "bash";

// Dark code block with a copy button. Client-rendered (clipboard needs the
// browser); the light Prism build ships only the two registered grammars.
export function CodeBlock({
  code,
  language,
}: {
  code: string;
  language: SupportedLanguage;
}) {
  const [copied, setCopied] = React.useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(code);
    } catch {
      // Clipboard API unavailable (permissions, insecure context) — the
      // textarea fallback still gets the text onto the clipboard.
      const area = document.createElement("textarea");
      area.value = code;
      document.body.appendChild(area);
      area.select();
      document.execCommand("copy");
      document.body.removeChild(area);
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div className="relative">
      <SyntaxHighlighter
        language={language}
        style={oneDark}
        customStyle={{
          margin: 0,
          padding: "1rem",
          paddingRight: "3rem",
          borderRadius: "0.5rem",
          background: "#2e3238ff",
          fontSize: "0.75rem",
          lineHeight: "1.625",
        }}
        codeTagProps={{
          style: { background: "transparent", fontFamily: "inherit" },
        }}
      >
        {code}
      </SyntaxHighlighter>
      <button
        onClick={() => void copy()}
        aria-label={copied ? "Copied" : "Copy code to clipboard"}
        title={copied ? "Copied" : "Copy"}
        className="absolute right-2 top-2 rounded-md p-1.5 text-white/60 transition-colors hover:bg-white/10 hover:text-white"
      >
        {copied ? (
          <FiCheck className="size-4" />
        ) : (
          <FiCopy className="size-4" />
        )}
      </button>
    </div>
  );
}
