import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

// shadcn/ui `cn()` helper — the single class-merging utility for the whole
// app. All shadcn components added later must import from here, not redefine.
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
