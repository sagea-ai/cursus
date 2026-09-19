import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { CodeBlock } from "./code-block";

describe("CodeBlock", () => {
  it("highlights python keywords and strings", () => {
    const html = renderToStaticMarkup(
      <CodeBlock
        language="python"
        code={'import x\nrun = cursus.init(project="demo")'}
      />,
    );
    expect(html).toContain("hljs-keyword");
    expect(html).toContain("hljs-string");
  });

  it("highlights bash without executing anything", () => {
    const html = renderToStaticMarkup(
      <CodeBlock
        language="bash"
        code={'curl -H "Authorization: x" https://y'}
      />,
    );
    expect(html).toContain("hljs-string");
    expect(html).not.toContain("<script");
  });
});
