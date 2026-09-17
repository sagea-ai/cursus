import { AcceptForm } from "@/components/accept-form";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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
    <main className="flex min-h-screen items-center justify-center p-6">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="text-xl">
            {preview ? `Join ${preview.org.name}` : "Invite invalid"}
          </CardTitle>
          <CardDescription>
            {preview ? (
              <>
                You were invited as{" "}
                <span className="text-foreground">{preview.email}</span>. Set a
                password to join the team.
              </>
            ) : (
              <>
                This invite link is invalid, expired, or already used. Ask a
                super admin to invite you again.
              </>
            )}
          </CardDescription>
        </CardHeader>
        {preview && (
          <CardContent>
            <AcceptForm token={decodeURIComponent(token)} />
          </CardContent>
        )}
      </Card>
    </main>
  );
}
