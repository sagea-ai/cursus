import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

import { CodeBlock } from "./code-block";

describe("CodeBlock", () => {
  it("highlights python keywords via Prism token spans", () => {
    const { container } = render(
      <CodeBlock
        language="python"
        code={'import x\nrun = cursus.init(project="demo")'}
      />,
    );
    // v16 renders bare `token` spans with inline colors (no type classes).
    const tokens = container.querySelectorAll("span.token");
    expect(tokens.length).toBeGreaterThan(0);
    expect(container.textContent).toContain('project="demo"');
  });

  it("escapes code instead of executing it", () => {
    const { container } = render(
      <CodeBlock language="bash" code={'echo "<script>alert(1)</script>"'} />,
    );
    expect(container.querySelector("script")).toBeNull();
    expect(container.textContent).toContain("<script>");
  });

  it("copies the snippet and confirms", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(window.navigator, { clipboard: { writeText } });
    render(<CodeBlock language="bash" code="curl https://x" />);
    fireEvent.click(
      screen.getByRole("button", { name: "Copy code to clipboard" }),
    );
    expect(writeText).toHaveBeenCalledWith("curl https://x");
    expect(await screen.findByRole("button", { name: "Copied" })).toBeVisible();
  });
});
