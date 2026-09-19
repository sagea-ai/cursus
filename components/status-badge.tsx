import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

// Single status-badge component, used on every page (built once,
// never copy-pasted). Colors: running = SAGEA blue pulse, finished =
// neutral, crashed/killed = the one app-wide warning tone (--warning).
export function StatusBadge({ status }: { status: string }) {
  if (status === "RUNNING") {
    return (
      <Badge variant="default">
        <span className="status-running-dot inline-block size-1.5 rounded-full bg-accent-pale" />
        R
      </Badge>
    );
  }
  if (status === "FINISHED") {
    return <Badge variant="secondary">Finished</Badge>;
  }
  return (
    <Badge
      variant="warning"
      className={cn(status === "KILLED" && "opacity-90")}
    >
      {status.toLowerCase()}
    </Badge>
  );
}
