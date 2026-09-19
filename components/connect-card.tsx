import Link from "next/link";

import { CodeBlock } from "@/components/code-block";
import { CopyButton } from "@/components/copy-button";
import { deploymentBaseUrl } from "@/lib/deployment";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

// "Connect your training script": the deployment's base URL plus a
// copy-paste setup block. Lives atop the API Keys page — the one place
// every SDK user must visit anyway.
export async function ConnectCard({ orgSlug }: { orgSlug: string }) {
  const baseUrl = await deploymentBaseUrl();
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">
          Connect your training script
        </CardTitle>
        <CardDescription>
          Point the SDK at this deployment, then authenticate with a key created
          below.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-muted-foreground">Base URL</span>
          <code className="break-all rounded-md bg-muted px-2 py-1 font-mono text-xs">
            {baseUrl}
          </code>
          <CopyButton text={baseUrl} label="Copy URL" />
        </div>
        <CodeBlock
          language="bash"
          code={`pip install sagea-cursus
export CURSUS_BASE_URL="${baseUrl}"
export CURSUS_API_KEY="cursus_..."  # create a key below, shown once`}
        />
        <p className="text-xs text-muted-foreground">
          New here? The{" "}
          <Link
            href={`/${orgSlug}/dashboard`}
            className="text-accent-pale hover:underline"
          >
            dashboard setup guide
          </Link>{" "}
          walks through the first run.
        </p>
      </CardContent>
    </Card>
  );
}
