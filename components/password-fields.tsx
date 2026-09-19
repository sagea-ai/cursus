"use client";

import * as React from "react";
import { FiCheck, FiX } from "react-icons/fi";

import { authInputClass } from "@/components/auth-shell";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

// Password + confirm with a LIVE strength checklist and match indicator.
// Mirrors passwordSchema (lib/validation.ts); the server re-enforces every
// rule, this is guidance, not the gate.
const RULES = [
  {
    id: "length",
    label: "At least 12 characters",
    test: (p: string) => p.length >= 12,
  },
  {
    id: "upper",
    label: "Uppercase letter (A–Z)",
    test: (p: string) => /[A-Z]/.test(p),
  },
  {
    id: "lower",
    label: "Lowercase letter (a–z)",
    test: (p: string) => /[a-z]/.test(p),
  },
  { id: "digit", label: "Number (0–9)", test: (p: string) => /[0-9]/.test(p) },
  {
    id: "special",
    label: "Special character",
    test: (p: string) => /[^A-Za-z0-9]/.test(p),
  },
];

export function passwordMeetsAll(password: string): boolean {
  return RULES.every((r) => r.test(password));
}

export function PasswordFields({
  password,
  confirm,
  onPassword,
  onConfirm,
  idPrefix,
  passwordLabel = "Password",
  confirmLabel = "Confirm password",
}: {
  password: string;
  confirm: string;
  onPassword: (v: string) => void;
  onConfirm: (v: string) => void;
  idPrefix: string;
  passwordLabel?: string;
  confirmLabel?: string;
}) {
  const match: "idle" | "match" | "mismatch" =
    confirm.length === 0 ? "idle" : password === confirm ? "match" : "mismatch";

  return (
    <>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`${idPrefix}-password`}>{passwordLabel}</Label>
        <input
          id={`${idPrefix}-password`}
          type="password"
          autoComplete="new-password"
          required
          value={password}
          onChange={(e) => onPassword(e.target.value)}
          className={authInputClass}
          aria-describedby={`${idPrefix}-rules`}
        />
        <ul
          id={`${idPrefix}-rules`}
          aria-label="Password requirements"
          className="mt-0.5 flex flex-col gap-1"
        >
          {RULES.map((rule) => {
            const ok = rule.test(password);
            return (
              <li
                key={rule.id}
                aria-label={`${rule.label}: ${ok ? "met" : "not met"}`}
                className={cn(
                  "flex items-center gap-1.5 text-xs",
                  ok ? "text-green-700" : "text-neutral-400",
                )}
              >
                {ok ? (
                  <FiCheck className="size-3.5" aria-hidden />
                ) : (
                  <FiX className="size-3.5" aria-hidden />
                )}
                {rule.label}
              </li>
            );
          })}
        </ul>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`${idPrefix}-confirm`}>{confirmLabel}</Label>
        <input
          id={`${idPrefix}-confirm`}
          type="password"
          autoComplete="new-password"
          required
          value={confirm}
          onChange={(e) => onConfirm(e.target.value)}
          className={authInputClass}
          aria-describedby={`${idPrefix}-match`}
        />
        <p
          id={`${idPrefix}-match`}
          role={match === "idle" ? undefined : "status"}
          className={cn(
            "text-xs",
            match === "match" && "font-medium text-green-700",
            match === "mismatch" && "font-medium text-red-600",
            match === "idle" && "text-neutral-400",
          )}
        >
          {match === "match"
            ? "Passwords match"
            : match === "mismatch"
              ? "Passwords do not match"
              : "Repeat it exactly"}
        </p>
      </div>
    </>
  );
}
