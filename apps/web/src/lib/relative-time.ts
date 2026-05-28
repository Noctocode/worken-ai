/**
 * Render an ISO timestamp as a coarse "X ago" string for chip-style
 * surfaces (synced sources, audit rows, etc.).
 *
 * Buckets: "just now" (<60s) → "Nm ago" (<60m) → "Nh ago" (<24h) →
 * "Nd ago" (<30d) → localeDateString. The 30-day cutoff matches the
 * Knowledge Core source list — after a month the precise day
 * matters more than the relative distance.
 *
 * Not for high-density UIs (notifications-popover uses a 7-day
 * cutoff there; the difference is intentional, don't unify without
 * design sign-off).
 */
export function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}
