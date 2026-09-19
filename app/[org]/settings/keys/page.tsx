import { ConnectCard } from "@/components/connect-card";
import { KeysManager, type KeyRow } from "@/components/keys-manager";
import { deploymentBaseUrl } from "@/lib/deployment";
import { listKeys } from "@/lib/keys";
import { requirePageSession } from "@/lib/page-auth";

export default async function KeysPage({
  params,
}: {
  params: Promise<{ org: string }>;
}) {
  const { org: orgSlug } = await params;
  const { session, org } = await requirePageSession(orgSlug);
  const keys = await listKeys(session);

  const rows: KeyRow[] = keys.map((k) => ({
    id: k.id,
    label: k.label,
    ownerEmail: k.ownerEmail,
    createdAt: k.createdAt.toISOString(),
    lastUsedAt: k.lastUsedAt ? k.lastUsedAt.toISOString() : null,
    revokedAt: k.revokedAt ? k.revokedAt.toISOString() : null,
  }));

  return (
    <main className="mx-auto flex w-full max-w-4xl flex-col gap-4 p-8">
      <div>
        <p className="text-xs text-muted-foreground">{org.name}</p>
        <h1 className="text-2xl font-semibold">API Keys</h1>
      </div>
      <ConnectCard orgSlug={org.slug} />
      <KeysManager
        keys={rows}
        isAdmin={session.role === "SUPER_ADMIN"}
        orgSlug={org.slug}
        baseUrl={await deploymentBaseUrl()}
      />
    </main>
  );
}
