import Link from "next/link";
import { notFound } from "next/navigation";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { isNotFoundError } from "@/lib/http";
import { requirePageSession } from "@/lib/page-auth";
import { getKeyDetail } from "@/lib/keys";

function describeAction(action: string): string {
  switch (action) {
    case "api_key.created":
      return "Created";
    case "api_key.rotated":
      return "Rotated";
    case "api_key.revoked":
      return "Revoked";
    default:
      return action;
  }
}

export default async function KeyDetailPage({
  params,
}: {
  params: Promise<{ org: string; keyId: string }>;
}) {
  const { org: orgSlug, keyId } = await params;
  const { session, org } = await requirePageSession(orgSlug);
  let key;
  try {
    key = await getKeyDetail(session, keyId);
  } catch (e) {
    if (isNotFoundError(e)) notFound();
    throw e;
  }

  return (
    <main className="mx-auto flex w-full max-w-4xl flex-col gap-4 p-8">
      <div>
        <p className="text-xs text-muted-foreground">
          <Link href={`/${org.slug}/settings/keys`} className="hover:underline">
            API Keys
          </Link>{" "}
          / {key.label}
        </p>
        <div className="mt-1 flex flex-wrap items-center gap-3">
          <h1 className="font-mono text-2xl font-semibold">{key.label}</h1>
          {key.revokedAt ? (
            <Badge variant="warning">Revoked</Badge>
          ) : (
            <Badge variant="secondary">Active</Badge>
          )}
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          {session.role === "SUPER_ADMIN" && key.ownerEmail
            ? `Owned by ${key.ownerEmail} · `
            : ""}
          Created {key.createdAt.toLocaleString()}
          {key.lastUsedAt
            ? ` · last used ${key.lastUsedAt.toLocaleString()}`
            : " · never used"}
          {key.revokedAt ? ` · revoked ${key.revokedAt.toLocaleString()}` : ""}
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">History</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {key.events.length === 0 ? (
            <p className="p-5 text-sm text-muted-foreground">
              No recorded activity.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>When</TableHead>
                  <TableHead>Action</TableHead>
                  <TableHead>By</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {key.events.map((e) => (
                  <TableRow key={e.id}>
                    <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                      {e.createdAt.toLocaleString()}
                    </TableCell>
                    <TableCell className="text-xs font-medium">
                      {describeAction(e.action)}
                    </TableCell>
                    <TableCell className="max-w-44 truncate text-xs text-muted-foreground">
                      {e.actor.name || e.actor.email}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
