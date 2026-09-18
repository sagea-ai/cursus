// Pure CSV helpers (no DB) — safe to import from DB-free unit tests.

/** Minimal RFC-4180 cell escaping (keys are user-controlled strings). */
export function toCsvCell(value: string | number): string {
  const s = String(value);
  if (s.includes(",") || s.includes('"') || s.includes("\n")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}
