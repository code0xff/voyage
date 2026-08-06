/** Product wordmark: a small rounded primary tile with an icon + two-tone name.
 *  Edit the defaults (or pass props) to brand it for your app:
 *    <Brand name="acme" suffix="console" /> renders  [⚡] acme console
 *  Swap the lucide icon for your own; keep the h-7 w-7 tile + tracking-tight text. */
import { Zap, type LucideIcon } from "lucide-react";

export function Brand({
  name = "app",
  suffix = "console",
  icon: Icon = Zap,
}: {
  name?: string;
  suffix?: string;
  icon?: LucideIcon;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="flex h-7 w-7 items-center justify-center rounded-md bg-primary text-primary-foreground">
        <Icon className="h-4 w-4" />
      </span>
      <span className="text-sm font-semibold tracking-tight">
        {name} {suffix && <span className="text-muted-foreground">{suffix}</span>}
      </span>
    </div>
  );
}
