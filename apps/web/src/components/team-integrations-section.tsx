"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowUpRight,
  Info,
  KeyRound,
  Loader2,
  PlugZap,
} from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { useAuth } from "@/components/providers";
import {
  fetchLinkableIntegrations,
  fetchTeamIntegrationLinks,
  setTeamIntegrationLinkEnabled,
  setTeamIntegrationLinks,
  type LinkableIntegration,
  type TeamIntegrationLink,
} from "@/lib/api";

/* ─── Icons ──────────────────────────────────────────────────────────── */

function GeminiIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none">
      <defs>
        <linearGradient id="team-gemini-grad" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#4285F4" />
          <stop offset="100%" stopColor="#A142F4" />
        </linearGradient>
      </defs>
      <path
        d="M12 2C12 2 7 7 7 12C7 17 12 22 12 22C12 22 17 17 17 12C17 7 12 2 12 2Z"
        fill="url(#team-gemini-grad)"
      />
      <path
        d="M2 12C2 12 7 7 12 7C17 7 22 12 22 12C22 12 17 17 12 17C7 17 2 12 2 12Z"
        fill="url(#team-gemini-grad)"
        opacity="0.6"
      />
    </svg>
  );
}

function BrandIcon({ color, letter }: { color: string; letter: string }) {
  return (
    <div
      className="flex h-5 w-5 items-center justify-center rounded-sm text-[10px] font-bold text-white"
      style={{ backgroundColor: color }}
    >
      {letter}
    </div>
  );
}

function iconForProvider(providerId: string): React.ReactNode {
  // Compact mapping of providerId → glyph. Mirrors the IntegrationTab
  // visual treatment so a Gemini key looks the same here as it does
  // on /teams?tab=integration. Custom rows fall through to the
  // neutral KeyRound below.
  switch (providerId) {
    case "google":
    case "gemini":
      return <GeminiIcon />;
    case "openai":
      return <BrandIcon color="#10a37f" letter="G" />;
    case "deepseek":
      return <BrandIcon color="#1a73e8" letter="D" />;
    case "mistral":
      return <BrandIcon color="#f7931e" letter="M" />;
    case "anthropic":
      return <BrandIcon color="#d97706" letter="C" />;
    case "perplexity":
      return <BrandIcon color="#20b2aa" letter="P" />;
    case "qwen":
      return <BrandIcon color="#7c3aed" letter="Q" />;
    case "cohere":
      return <BrandIcon color="#0078d4" letter="Co" />;
    case "xai":
      return <BrandIcon color="#1a1a1a" letter="X" />;
    case "custom":
    default:
      return <KeyRound className="h-4 w-4 text-text-3" />;
  }
}

/* ─── Section ────────────────────────────────────────────────────────── */

/**
 * AI Provider Key management on the team-details page. Replaces the
 * legacy add-a-key flow with a *picker* over the integrations the
 * caller already configured on /teams?tab=integration:
 *
 *   - Keys are not entered here. The banner steers admins back to the
 *     Integration tab as the single place to add / rotate / delete a
 *     personal BYOK row.
 *   - "Active for this team" lists everything currently linked, with
 *     a per-team Switch and (for caller-owned rows) an Unlink action.
 *     Rows linked by other admins are visible read-only; only their
 *     owner can remove the link, but anyone with team-edit rights
 *     can flip the per-team toggle.
 *   - "Your integrations" surfaces every caller-owned personal
 *     integration as a save-staged checkbox — pre-checked when
 *     already linked. Save commits the diff in a single round-trip.
 */
export function TeamIntegrationsSection({
  teamId,
  canManage,
}: {
  teamId: string;
  canManage: boolean;
}) {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const callerId = user?.id ?? null;

  const linksKey = ["team-integration-links", teamId] as const;
  const linkableKey = ["team-linkable-integrations", teamId] as const;

  const { data: links = [], isLoading: linksLoading } = useQuery({
    queryKey: linksKey,
    queryFn: () => fetchTeamIntegrationLinks(teamId),
  });
  const { data: linkable = [], isLoading: linkableLoading } = useQuery({
    queryKey: linkableKey,
    queryFn: () => fetchLinkableIntegrations(teamId),
  });

  // Save-staged picker state. Seeded from `linkable.alreadyLinked` so
  // the first paint reflects the current backend set; re-seeded any
  // time the linkable query refetches with a fresh server state so
  // an outside change (another tab, another admin) doesn't leave the
  // user staring at a phantom "unsaved" badge.
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const initialPickedKey = useMemo(
    () =>
      linkable
        .filter((l) => l.alreadyLinked)
        .map((l) => l.integrationId)
        .sort()
        .join(","),
    [linkable],
  );
  useEffect(() => {
    setPicked(
      new Set(
        linkable
          .filter((l) => l.alreadyLinked)
          .map((l) => l.integrationId),
      ),
    );
  }, [initialPickedKey, linkable]);

  const initialPickedSet = useMemo(() => {
    return new Set(
      linkable
        .filter((l) => l.alreadyLinked)
        .map((l) => l.integrationId),
    );
  }, [linkable]);

  const hasUnsavedChanges = useMemo(() => {
    if (picked.size !== initialPickedSet.size) return true;
    for (const id of picked) if (!initialPickedSet.has(id)) return true;
    return false;
  }, [picked, initialPickedSet]);

  const saveMutation = useMutation({
    mutationFn: () =>
      setTeamIntegrationLinks(teamId, Array.from(picked)),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: linksKey });
      queryClient.invalidateQueries({ queryKey: linkableKey });
      toast.success("Team integrations updated.");
    },
    onError: (err: Error) =>
      toast.error(err.message ?? "Couldn't save team integrations."),
  });

  // Per-link enabled toggle. Optimistic update so the Switch never
  // shows its disabled cursor-not-allowed state during the round
  // trip; cache rolls back on error.
  const toggleMutation = useMutation({
    mutationFn: ({
      integrationId,
      next,
    }: {
      integrationId: string;
      next: boolean;
    }) => setTeamIntegrationLinkEnabled(teamId, integrationId, next),
    onMutate: async ({ integrationId, next }) => {
      await queryClient.cancelQueries({ queryKey: linksKey });
      const previous =
        queryClient.getQueryData<TeamIntegrationLink[]>(linksKey);
      queryClient.setQueryData<TeamIntegrationLink[]>(linksKey, (old) =>
        old?.map((l) =>
          l.integrationId === integrationId ? { ...l, linkEnabled: next } : l,
        ),
      );
      return { previous };
    },
    onError: (err: Error, _vars, ctx) => {
      if (ctx?.previous) {
        queryClient.setQueryData(linksKey, ctx.previous);
      }
      toast.error(err.message ?? "Couldn't toggle integration.");
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: linksKey });
    },
  });

  const loading = linksLoading || linkableLoading;

  // Cross-section split: caller-owned vs others' links. Caller-owned
  // are managed via the picker checkboxes below; others' links show
  // up here as read-only rows (the toggle still works because a team
  // admin can pause use of another's key without owning it).
  const callerOwnsIntegration = useMemo(() => {
    const ids = new Set(linkable.map((l) => l.integrationId));
    return (link: TeamIntegrationLink) => ids.has(link.integrationId);
  }, [linkable]);

  const othersLinks = links.filter((l) => !callerOwnsIntegration(l));
  const myLinks = links.filter((l) => callerOwnsIntegration(l));

  const noPersonalKeys = !loading && linkable.length === 0;
  const noActivity = !loading && links.length === 0 && linkable.length === 0;

  return (
    <div className="flex flex-col gap-5">
      <header className="flex items-end justify-between gap-3">
        <div>
          <h2 className="text-[18px] font-bold text-text-1">
            AI Provider Keys
          </h2>
          <p className="mt-1 text-[13px] text-text-2">
            Pick which of your personal keys this team can use for chat,
            arena, and tooling.
          </p>
        </div>
      </header>

      {/* Warning banner: keys are managed elsewhere. Always rendered
          so the redirect to /teams?tab=integration is one click away,
          even when the team already has links. */}
      <div className="flex items-start gap-3 rounded-lg border border-warning-2 bg-warning-1/40 px-4 py-3">
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-warning-7" />
        <div className="flex-1 text-[13px] leading-relaxed text-text-2">
          <p className="font-medium text-text-1">
            AI Provider Keys are configured in the Integration tab.
          </p>
          <p className="mt-1 text-text-3">
            Add or rotate keys there. Below, activate the ones you want
            this team&apos;s members to use. Rotation on the Integration
            tab applies everywhere a key is linked — no need to update
            per team.
          </p>
        </div>
        <Link
          href="/teams?tab=integration"
          className="inline-flex shrink-0 items-center gap-1 rounded-md bg-bg-white px-3 py-1.5 text-[12px] font-medium text-text-1 transition-colors hover:bg-bg-1"
        >
          Manage keys
          <ArrowUpRight className="h-3.5 w-3.5" />
        </Link>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-[13px] text-text-3">
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading
          integrations…
        </div>
      ) : noActivity ? (
        <EmptyStateCta />
      ) : (
        <>
          {/* Active for this team — current link set, including links
              owned by other admins. Read-only checkbox state for
              those; per-team Switch always works for any team
              manager. */}
          {links.length > 0 && (
            <section className="flex flex-col gap-2">
              <h3 className="text-[13px] font-semibold text-text-1">
                Active for this team
              </h3>
              <ul className="flex flex-col divide-y divide-border-2 overflow-hidden rounded-lg border border-border-2 bg-bg-white">
                {[...myLinks, ...othersLinks].map((link) => {
                  const mine = link.ownerId === callerId;
                  return (
                    <li
                      key={link.integrationId}
                      className="flex items-center gap-3 px-4 py-3"
                    >
                      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-bg-1">
                        {iconForProvider(link.providerId)}
                      </span>
                      <div className="flex min-w-0 flex-1 flex-col">
                        <span className="truncate text-[14px] font-medium text-text-1">
                          {link.displayName}
                          {link.isCustom && link.apiUrl ? (
                            <span className="ml-2 text-[12px] font-normal text-text-3">
                              {link.apiUrl}
                            </span>
                          ) : null}
                        </span>
                        <span className="text-[12px] text-text-3">
                          {mine
                            ? "Your key"
                            : `by ${link.ownerName ?? "another admin"}`}
                          {!link.hasApiKey && " · no API key set"}
                          {!link.integrationEnabled &&
                            " · disabled in Integration tab"}
                        </span>
                      </div>
                      {canManage ? (
                        <div className="flex shrink-0 items-center gap-3">
                          <Switch
                            checked={link.linkEnabled}
                            onCheckedChange={(next) =>
                              toggleMutation.mutate({
                                integrationId: link.integrationId,
                                next,
                              })
                            }
                            aria-label={
                              link.linkEnabled
                                ? "Pause use on this team"
                                : "Resume use on this team"
                            }
                          />
                          <span className="w-12 text-right text-[12px] text-text-3">
                            {link.linkEnabled ? "Active" : "Paused"}
                          </span>
                        </div>
                      ) : (
                        <span className="shrink-0 text-[12px] text-text-3">
                          {link.linkEnabled ? "Active" : "Paused"}
                        </span>
                      )}
                    </li>
                  );
                })}
              </ul>
            </section>
          )}

          {/* Picker for caller's own integrations. Save-staged so
              admin can untick three at once and commit in one
              round-trip — important when each commit could rotate
              chat routing for every team member. */}
          {canManage && linkable.length > 0 && (
            <section className="flex flex-col gap-2">
              <div className="flex items-end justify-between gap-3">
                <h3 className="text-[13px] font-semibold text-text-1">
                  Your AI Provider Keys
                </h3>
                {hasUnsavedChanges && (
                  <span className="text-[12px] text-text-3">
                    Unsaved changes
                  </span>
                )}
              </div>
              <ul className="flex flex-col divide-y divide-border-2 overflow-hidden rounded-lg border border-border-2 bg-bg-white">
                {linkable.map((row) => (
                  <PickerRow
                    key={row.integrationId}
                    row={row}
                    checked={picked.has(row.integrationId)}
                    onToggle={(next) => {
                      setPicked((prev) => {
                        const out = new Set(prev);
                        if (next) out.add(row.integrationId);
                        else out.delete(row.integrationId);
                        return out;
                      });
                    }}
                  />
                ))}
              </ul>
              <div className="flex items-center justify-end gap-2 pt-1">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="cursor-pointer"
                  disabled={!hasUnsavedChanges || saveMutation.isPending}
                  onClick={() => setPicked(new Set(initialPickedSet))}
                >
                  Discard
                </Button>
                <Button
                  type="button"
                  size="sm"
                  className="cursor-pointer bg-primary-6 hover:bg-primary-7"
                  disabled={!hasUnsavedChanges || saveMutation.isPending}
                  onClick={() => saveMutation.mutate()}
                >
                  {saveMutation.isPending ? (
                    <>
                      <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                      Saving…
                    </>
                  ) : (
                    "Save changes"
                  )}
                </Button>
              </div>
            </section>
          )}

          {canManage && noPersonalKeys && links.length === 0 && (
            <EmptyStateCta />
          )}

          {canManage && noPersonalKeys && links.length > 0 && (
            <div className="flex items-start gap-3 rounded-lg border border-border-2 bg-bg-1/60 px-4 py-3 text-[13px] text-text-2">
              <PlugZap className="mt-0.5 h-4 w-4 shrink-0 text-text-3" />
              <div>
                You haven&apos;t configured any keys of your own yet — the
                links above were added by other team admins. Add your
                first key on the Integration tab to link it here.
              </div>
            </div>
          )}

          {!canManage && (
            <div className="flex items-start gap-3 rounded-lg border border-border-2 bg-bg-1/60 px-4 py-3 text-[13px] text-text-2">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-text-3" />
              <div>
                Read-only view. Only team owners, admins, managers, and
                editors can link or unlink AI Provider Keys.
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function PickerRow({
  row,
  checked,
  onToggle,
}: {
  row: LinkableIntegration;
  checked: boolean;
  onToggle: (next: boolean) => void;
}) {
  // Disable + explain why when:
  //   - the integration is master-off on the Integration tab, or
  //   - another personal predef already holds this team's slot.
  const masterOff = !row.integrationEnabled;
  const blocked = row.blockedByProvider;
  const disabled = (masterOff && !checked) || blocked;
  const reason = blocked
    ? `Another ${row.providerId} key is already linked to this team. Unlink it first.`
    : masterOff
      ? "This integration is disabled on the Integration tab. Re-enable it there to link."
      : null;
  return (
    <li className="flex items-center gap-3 px-4 py-3">
      <input
        type="checkbox"
        className="h-4 w-4 cursor-pointer accent-primary-6 disabled:cursor-not-allowed"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onToggle(e.target.checked)}
        aria-label={`Link ${row.displayName} to this team`}
      />
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-bg-1">
        {iconForProvider(row.providerId)}
      </span>
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-[14px] font-medium text-text-1">
          {row.displayName}
          {row.isCustom && row.apiUrl ? (
            <span className="ml-2 text-[12px] font-normal text-text-3">
              {row.apiUrl}
            </span>
          ) : null}
        </span>
        <span className="text-[12px] text-text-3">
          {row.hasApiKey ? "Personal key" : "No API key set"}
          {!row.integrationEnabled && " · disabled on Integration tab"}
          {reason && ` · ${reason}`}
        </span>
      </div>
    </li>
  );
}

function EmptyStateCta() {
  return (
    <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-border-3 bg-bg-1/40 px-6 py-10 text-center">
      <PlugZap className="h-8 w-8 text-text-3" strokeWidth={1.5} />
      <div className="flex flex-col gap-1">
        <p className="text-[14px] font-medium text-text-1">
          No AI Provider Keys yet
        </p>
        <p className="max-w-[420px] text-[12px] text-text-3">
          Add your first key on the Integration tab — Anthropic, OpenAI,
          Gemini, or a self-hosted endpoint. Once it&apos;s there, come
          back to activate it for this team.
        </p>
      </div>
      <Link
        href="/teams?tab=integration"
        className="inline-flex items-center gap-1 rounded-md bg-primary-6 px-3 py-1.5 text-[13px] font-medium text-text-white transition-colors hover:bg-primary-7"
      >
        Add your first key
        <ArrowUpRight className="h-3.5 w-3.5" />
      </Link>
    </div>
  );
}
