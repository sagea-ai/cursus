// URL slug helper shared by projects, orgs, and groups. Single definition
// (previously lived in lib/runs.ts; moved out so lib/groups.ts can use it
// without a runs↔groups import cycle).
export function slugify(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/_/g, "-")
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 128);
}
