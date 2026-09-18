import { cookies } from "next/headers";
import Image from "next/image";
import Link from "next/link";

import { AuthShell } from "@/components/auth-shell";
import { Button } from "@/components/ui/button";
import { db } from "@/lib/db";
import { SESSION_COOKIE, verifySessionToken } from "@/lib/session";

// Branded 404 in the login-page idiom: cursos mark, big code, and a way
// back to the dashboard (or login when logged out).
export default async function NotFound() {
  let dashboardHref = "/login";
  const jar = await cookies();
  const claimed = await verifySessionToken(
    jar.get(SESSION_COOKIE)?.value ?? "",
  );
  if (claimed) {
    const user = await db.user.findUnique({
      where: { id: claimed.userId },
      include: { org: { select: { slug: true } } },
    });
    if (user) dashboardHref = `/${user.org.slug}/projects`;
  }

  return (
    <AuthShell
      tagline="Experiment tracking by SAGEA"
      footnote={<p>Lost? The dashboard is always one click away.</p>}
      card={
        <>
          <div className="flex flex-col items-center text-center">
            <Image
              src="/cursos.svg"
              alt="Cursus"
              width={140}
              height={140}
              className="h-12 w-12"
            />
            <p className="mt-6 text-[56px] font-bold leading-none tracking-tight">
              404
            </p>
            <p className="mt-3 text-sm text-neutral-500">
              This page could not be found. It may have been moved, deleted, or
              you followed a stale link.
            </p>
          </div>
          <Button
            asChild
            className="mt-7 h-10 w-full bg-neutral-900 text-sm font-medium text-white hover:bg-neutral-800"
          >
            <Link href={dashboardHref}>Go back to dashboard</Link>
          </Button>
        </>
      }
    />
  );
}
