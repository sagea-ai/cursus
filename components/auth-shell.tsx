import Image from "next/image";
import * as React from "react";

// Shared shell for the public auth routes (login, onboarding): brand panel
// with a centered card on the left, full-height artwork on the right.
// Deliberately light-themed — standalone routes outside the dark dashboard.
export function AuthShell({
  tagline,
  card,
  footnote,
}: {
  tagline: string;
  card: React.ReactNode;
  footnote: React.ReactNode;
}) {
  return (
    <main className="flex min-h-screen bg-[#f4f4f5] text-neutral-900">
      <div className="flex flex-1 flex-col items-center justify-center px-6 py-12">
          <Image
            src="/sagea_banner.png"
            alt="SAGEA"
            width={600}
            height={163}
            className="h-9 w-auto invert"
            priority
          />
        <p className="mt-4 text-[15px] font-medium text-neutral-700">
          {tagline}
        </p>

        <div className="mt-10 w-full max-w-md rounded-2xl border border-neutral-200 bg-white p-8 shadow-sm">
          {card}
        </div>

        <div className="mt-5 max-w-md text-center text-xs leading-relaxed text-neutral-500">
          {footnote}
        </div>
      </div>

      <div className="relative hidden flex-1 lg:block">
        <Image
          src="/artwork.webp"
          alt=""
          fill
          sizes="50vw"
          className="object-cover"
          priority
        />
      </div>
    </main>
  );
}
