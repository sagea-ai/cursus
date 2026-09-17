import Link from "next/link";
import { FiActivity, FiFolder, FiKey, FiUsers } from "react-icons/fi";

import { SignOutButton } from "@/components/sign-out-button";
import { Badge } from "@/components/ui/badge";
import { requirePageSession } from "@/lib/page-auth";
import { cn } from "@/lib/utils";

const NAV = [
  { href: "projects", label: "Projects", icon: FiFolder },
  { href: "team", label: "Team", icon: FiUsers },
  { href: "settings/keys", label: "API Keys", icon: FiKey },
];

export default async function OrgLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ org: string }>;
}) {
  const { org: orgSlug } = await params;
  const { session, org } = await requirePageSession(orgSlug);

  return (
    <div className="flex min-h-screen">
      <aside className="flex w-60 shrink-0 flex-col gap-1 border-r border-border bg-card p-4">
        <div className="mb-4 flex items-center gap-2 px-2">
          <span className="flex size-8 items-center justify-center rounded-lg bg-primary/15 text-accent-pale">
            <FiActivity className="size-4" />
          </span>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold">{org.name}</p>
            <p className="text-xs text-muted-foreground">Cursus</p>
          </div>
        </div>
        {NAV.map((item) => (
          <Link
            key={item.href}
            href={`/${org.slug}/${item.href}`}
            className={cn(
              "flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
            )}
          >
            <item.icon className="size-4" />
            {item.label}
          </Link>
        ))}
        <div className="mt-auto flex flex-col gap-2 border-t border-border pt-3">
          <Badge variant="secondary" className="w-fit">
            {session.role === "SUPER_ADMIN" ? "super admin" : "member"}
          </Badge>
          <SignOutButton email={session.email} />
        </div>
      </aside>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
