import hljs from "highlight.js/lib/core";
import bash from "highlight.js/lib/languages/bash";
import python from "highlight.js/lib/languages/python";

hljs.registerLanguage("python", python);
hljs.registerLanguage("bash", bash);
hljs.registerLanguage("shell", bash);

// Syntax-highlighted code block, rendered server-side (no client JS).
// Real grammars via highlight.js core + two languages — not regex guesswork.
export function CodeBlock({
  code,
  language,
}: {
  code: string;
  language: "python" | "bash";
}) {
  const html =
    language === "python"
      ? hljs.highlight(code, { language: "python" }).value
      : hljs.highlight(code, { language: "bash" }).value;
  return (
    <pre className="overflow-x-auto rounded-md bg-muted p-4 font-mono text-xs leading-relaxed">
      <code className="hljs" dangerouslySetInnerHTML={{ __html: html }} />
    </pre>
  );
}
