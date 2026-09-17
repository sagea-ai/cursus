import { Suspense } from "react";

import { CompareView } from "@/components/compare-view";
import { requirePageSession } from "@/lib/page-auth";

export default async function ComparePage({
  params,
}: {
  params: Promise<{ org: string; project: string }>;
}) {
  const { org: orgSlug, project: projectSlug } = await params;
  const { org } = await requirePageSession(orgSlug);
  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-4 p-8">
      <div>
        <p className="text-xs text-muted-foreground">
          {org.name} / {projectSlug} / compare
        </p>
        <h1 className="text-2xl font-semibold">Compare runs</h1>
      </div>
      <Suspense
        fallback={<p className="text-sm text-muted-foreground">Loading…</p>}
      >
        <CompareView basePath={`/${org.slug}/${projectSlug}/runs`} />
      </Suspense>
    </main>
  );
}
