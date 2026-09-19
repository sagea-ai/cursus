// Docs guard: docs/ holds product documentation only (platform + SDK).
// Planning artifacts (PRDs, gap analyses, roadmaps) live in issues/branches,
// never in docs/. Run: npm run lint:docs. Enforced in CI as a blocking check.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const DOCS = new URL("../docs", import.meta.url).pathname;

// A "PRD" mention is the word itself, not substrings (spread, upgrade…).
const FILENAME_HIT = /(^|[^a-z])prd([^a-z]|$)/i;
const CONTENT_HIT = /\bPRD\b/;

function walk(dir) {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

const violations = [];
for (const file of walk(DOCS)) {
  const name = file.split("/").pop() ?? "";
  if (FILENAME_HIT.test(name)) {
    violations.push(`${file}: filename looks like a planning doc`);
    continue;
  }
  if (file.endsWith(".md") && CONTENT_HIT.test(readFileSync(file, "utf8"))) {
    violations.push(`${file}: contains a PRD reference`);
  }
}

if (violations.length > 0) {
  console.error(
    "Planning docs do not belong in docs/:\n" +
      violations.map((v) => `  - ${v}`).join("\n"),
  );
  process.exit(1);
}
console.log("Docs guard passed: docs/ holds product docs only.");
