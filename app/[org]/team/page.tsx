import { TeamManager, type MemberRow } from "@/components/team-manager";
import { requirePageSession } from "@/lib/page-auth";
import { listMembers } from "@/lib/team";

export default async function TeamPage({
  params,
}: {
  params: Promise<{ org: string }>;
}) {
  const { org: orgSlug } = await params;
  const { session, org } = await requirePageSession(orgSlug);
  const members = await listMembers(session);

  const rows: MemberRow[] = members.map((m) => ({
    id: m.id,
    email: m.email,
    name: m.name,
    role: m.role,
    createdAt: m.createdAt.toISOString(),
  }));

  return (
    <main className="mx-auto flex w-full max-w-4xl flex-col gap-4 p-8">
      <div>
        <p className="text-sm bg-green-500 rounded-sm inline-block text-white px-2 py-1 text-bold">
          {org.name}
        </p>
        <h1 className="text-2xl mt-2 font-semibold">Team</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Manage Your Team on Cursus.
        </p>
      </div>
      <TeamManager members={rows} isAdmin={session.role === "SUPER_ADMIN"} />
    </main>
  );
}
