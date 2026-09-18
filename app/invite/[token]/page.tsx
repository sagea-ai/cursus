import Image from "next/image";

import { AcceptForm } from "@/components/accept-form";
import { previewInvite } from "@/lib/team";

export default async function InvitePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  let preview: { email: string; org: { name: string } } | null = null;
  try {
    preview = await previewInvite(decodeURIComponent(token));
  } catch {
    preview = null;
  }

  return (
    <main className="relative flex min-h-screen items-center justify-center p-6">
      <Image
        src="/artwork.webp"
        alt=""
        fill
        sizes="100vw"
        className="object-cover"
        priority
      />
      <div className="relative w-full max-w-md">
        <div className="rounded-2xl border border-white/40 bg-white/95 p-8 shadow-2xl backdrop-blur">
          <div className="flex flex-col items-center text-center">
            <Image
              src="/cursos.svg"
              alt="Cursus"
              width={140}
              height={140}
              className="h-12 w-12"
            />
            <h1 className="mt-6 text-[26px] font-bold tracking-tight text-neutral-900">
              {preview ? `Join ${preview.org.name}` : "Invite invalid"}
            </h1>
            <p className="mt-1.5 text-sm text-neutral-500">
              {preview ? (
                <>
                  You were invited as{" "}
                  <span className="font-medium text-neutral-900">
                    {preview.email}
                  </span>
                  . Set a password to join the team.
                </>
              ) : (
                <>
                  This invite link is invalid, expired, or already used. Ask a
                  super admin to invite you again.
                </>
              )}
            </p>
          </div>
          {preview && <AcceptForm token={decodeURIComponent(token)} />}
        </div>
        <p className="mt-4 text-center text-xs leading-relaxed text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.45)]">
          Invites are single-use and expire after 1 hour. Ask a super admin for
          a fresh link if this one stops working.
        </p>
      </div>
    </main>
  );
}
