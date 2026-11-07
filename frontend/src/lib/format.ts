/** Pure formatting helpers shared by the shell views and their tests. */

export function shortPath(value: string, max = 52): string {
  if (!value) return "";
  if (value.length <= max) return value;
  const parts = value.split("/").filter(Boolean);
  if (parts.length < 3) return `…${value.slice(-(max - 1))}`;
  const tail = parts.slice(-2).join("/");
  return `…/${tail}`;
}

export function basename(value: string): string {
  return value.split("/").filter(Boolean).pop() || value;
}

export function relativeTime(value: string | null): string {
  if (!value) return "never";
  const then = Date.parse(value);
  if (!Number.isFinite(then)) return "unknown";
  const seconds = Math.round((Date.now() - then) / 1000);
  if (seconds < 45) return "just now";
  if (seconds < 3600) return `${Math.round(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.round(seconds / 3600)}h ago`;
  return `${Math.round(seconds / 86400)}d ago`;
}

export function keyLabel(key: { configured: boolean; source: string | null; writable: boolean }): string {
  if (!key.configured) return "Key needed";
  if (key.source === "env") return "From environment";
  if (key.source === "file") return key.writable ? "Key saved" : "Stored key";
  return key.source ? `Key: ${key.source}` : "Key saved";
}

export function providerState(provider: {
  active: boolean;
  configured: boolean;
  key: { configured: boolean };
  oauthOnly: boolean;
}): { label: string; tone: "success" | "warning" | "danger" | "muted" } {
  if (provider.active) return { label: "Active", tone: "success" };
  if (provider.configured) return { label: "Configured", tone: "warning" };
  if (provider.oauthOnly) return { label: "OAuth only", tone: "muted" };
  if (!provider.key.configured) return { label: "Available", tone: "muted" };
  return { label: "Key saved", tone: "warning" };
}

export function normalizedModelIds(input: string): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of input.split(/[\n,]+/)) {
    const id = raw.trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    result.push(id);
  }
  return result;
}

export function zoomLabel(value: number): string {
  return `${Math.round(value * 100)}%`;
}

export function harnessStepLabel(state: string): string {
  switch (state) {
    case "preparing": return "Preparing coding runtime";
    case "starting": return "Starting the harness";
    case "ready": return "Harness ready";
    case "stopping": return "Stopping the harness";
    case "error": return "Harness failed";
    default: return "Harness stopped";
  }
}
