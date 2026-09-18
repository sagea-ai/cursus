import { Sidebar } from "@/components/sidebar";
import { db } from "@/lib/db";
import { requirePageSession } from "@/lib/page-auth";

export default async function OrgLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ org: string }>;
}) {
  const { org: orgSlug } = await params;
  const { session, org } = await requirePageSession(orgSlug);
  const me = await db.user.findUnique({
    where: { id: session.userId },
    select: { name: true },
  });

  return (
    <div className="flex min-h-screen">
      <Sidebar
        orgSlug={org.slug}
        orgName={org.name}
        email={session.email}
        displayName={me?.name || session.email}
        role={session.role}
      />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
