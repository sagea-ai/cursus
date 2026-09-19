// CI dependency guard.
// Fails the build if lucide-react (or any non-shadcn UI library) appears in
// package.json. shadcn/ui primitives + react-icons (react-icons/fi) only.
// Run: npm run lint:deps. Enforced in CI as a blocking check.
import { readFileSync } from "node:fs";

const BANNED = [
  "lucide-react",
  "@mui/material",
  "@mui/icons-material",
  "@chakra-ui/react",
  "antd",
  "@mantine/core",
  "@headlessui/react",
];

const pkg = JSON.parse(readFileSync("package.json", "utf8"));
const deps = {
  ...(pkg.dependencies ?? {}),
  ...(pkg.devDependencies ?? {}),
};

const violations = BANNED.filter((name) => name in deps);
if (violations.length > 0) {
  console.error(
    `Banned UI dependencies found: ${violations.join(", ")}. ` +
      `Cursus uses shadcn/ui + react-icons exclusively.`,
  );
  process.exit(1);
}
console.log("Dependency guard passed: no banned UI libraries.");
