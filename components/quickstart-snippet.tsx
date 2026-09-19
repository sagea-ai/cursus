import { CodeBlock } from "@/components/code-block";
import { deploymentBaseUrl } from "@/lib/deployment";

// Copy-paste quickstart with the REAL deployment URL baked in (the server
// knows its own host — no placeholders to guess). Used by every empty
// state that onboards logging: dashboard, activity, projects, groups,
// artifacts.
export async function QuickstartSnippet({
  project = "demo",
  group,
}: {
  project?: string;
  group?: string;
}) {
  const baseUrl = await deploymentBaseUrl();
  const initArgs = `project="${project}"` + (group ? `, group="${group}"` : "");
  return (
    <div className="flex flex-col gap-3">
      <CodeBlock
        language="bash"
        code={`pip install sagea-cursus
export CURSUS_API_KEY="cursus_..."  # create one on the API Keys page
export CURSUS_BASE_URL="${baseUrl}"`}
      />
      <CodeBlock
        language="python"
        code={`import sagea_cursus as cursus

run = cursus.init(${initArgs})
cursus.log({"train/loss": 0.4}, step=1)
cursus.finish()`}
      />
    </div>
  );
}
