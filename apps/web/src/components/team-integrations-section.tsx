"use client";

import Link from "next/link";
import { useMemo } from "react";
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
import { Switch } from "@/components/ui/switch";
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
 *   - "Your AI Provider Keys" surfaces every caller-owned personal
 *     integration as a Switch — default off (= not linked). Flipping
 *     it on immediately links + activates the key for this team; off
 *     unlinks. No save button: the toggle IS the commit, so a brand-
 *     new team shows every available key idle until the admin opts
 *     in per row.
 *   - "Active for this team" surfaces links added by *other* admins
 *     so the caller knows what's available beyond their own. A
 *     per-team Switch pauses use without unlinking; only the link
 *     owner can fully remove it.
 */
export function TeamIntegrationsSection({
  teamId,
  canManage,
}: {
  teamId: string;
  canManage: boolean;
}) {
  const queryClient = useQueryClient();

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

  // Per-row link toggle for caller's own integrations. Each toggle
  // is its own immediate commit — no staged save / discard buttons —
  // so a brand-new team can be configured by flipping the Switches
  // one at a time without an extra "Save" click. Optimistic updates
  // flip both caches (links + linkable) ahead of the request, rolling
  // back on error so the Switch never enters its disabled state mid-
  // flight.
  //
  // The full-set PUT endpoint is reused: we read the caller's current
  // linked-ids from `linkable.alreadyLinked`, build the next set with
  // the target id added or removed, and ship it. Other admins' links
  // are *not* in this set and won't be touched (the BE scopes the
  // delta to caller-owned rows defensively, but staying out of those
  // ids in the request keeps the contract obvious).
  const linkToggleMutation = useMutation({
    mutationFn: ({
      integrationId,
      next,
    }: {
      integrationId: string;
      next: boolean;
    }) => {
      const currentMineLinked = linkable
        .filter((l) => l.alreadyLinked)
        .map((l) => l.integrationId);
      const target = next
        ? Array.from(new Set([...currentMineLinked, integrationId]))
        : currentMineLinked.filter((id) => id !== integrationId);
      return setTeamIntegrationLinks(teamId, target);
    },
    onMutate: async ({ integrationId, next }) => {
      await queryClient.cancelQueries({ queryKey: linkableKey });
      await queryClient.cancelQueries({ queryKey: linksKey });
      const prevLinkable =
        queryClient.getQueryData<LinkableIntegration[]>(linkableKey);
      const prevLinks =
        queryClient.getQueryData<TeamIntegrationLink[]>(linksKey);
      queryClient.setQueryData<LinkableIntegration[]>(linkableKey, (old) =>
        old?.map((l) =>
          l.integrationId === integrationId
            ? { ...l, alreadyLinked: next }
            : l,
        ),
      );
      return { prevLinkable, prevLinks };
    },
    onError: (err: Error, _vars, ctx) => {
      if (ctx?.prevLinkable) {
        queryClient.setQueryData(linkableKey, ctx.prevLinkable);
      }
      if (ctx?.prevLinks) {
        queryClient.setQueryData(linksKey, ctx.prevLinks);
      }
      toast.error(err.message ?? "Couldn't update team integrations.");
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: linkableKey });
      queryClient.invalidateQueries({ queryKey: linksKey });
    },
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
          {/* Picker for caller's own integrations. Each Switch is an
              immediate commit — flipping it links / unlinks the key
              for this team without a save step. Default off so a
              brand-new team starts every key idle and the admin opts
              in deliberately per provider. */}
          {canManage && linkable.length > 0 && (
            <section className="flex flex-col gap-2">
              <h3 className="text-[13px] font-semibold text-text-1">
                Your AI Provider Keys
              </h3>
              <ul className="flex flex-col divide-y divide-border-2 overflow-hidden rounded-lg border border-border-2 bg-bg-white">
                {linkable.map((row) => (
                  <PickerRow
                    key={row.integrationId}
                    row={row}
                    onToggle={(next) =>
                      linkToggleMutation.mutate({
                        integrationId: row.integrationId,
                        next,
                      })
                    }
                  />
                ))}
              </ul>
            </section>
          )}

          {/* Active for this team — only links added by OTHER admins.
              Caller's own links live in the picker above with a
              single Switch; surfacing them again here would just
              create two Switches doing different things. The
              per-team Switch on these rows pauses use without
              touching the underlying key. */}
          {othersLinks.length > 0 && (
            <section className="flex flex-col gap-2">
              <h3 className="text-[13px] font-semibold text-text-1">
                Linked by other admins
              </h3>
              <ul className="flex flex-col divide-y divide-border-2 overflow-hidden rounded-lg border border-border-2 bg-bg-white">
                {othersLinks.map((link) => (
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
                        by {link.ownerName ?? "another admin"}
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
                ))}
              </ul>
            </section>
          )}

          {canManage && noPersonalKeys && othersLinks.length === 0 && (
            <EmptyStateCta />
          )}

          {canManage && noPersonalKeys && othersLinks.length > 0 && (
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
  onToggle,
}: {
  row: LinkableIntegration;
  onToggle: (next: boolean) => void;
}) {
  // Switch state mirrors the BE truth: `alreadyLinked` flips on a
  // successful link / unlink (optimistically in onMutate, server-
  // confirmed onSettled). No local component state — the row stays
  // in sync with the cache even across refetches / cross-tab edits.
  const checked = row.alreadyLinked;
  // Disable + explain why when another personal predef of the
  // caller's already holds this team's slot. (The master-off case is
  // filtered out BE-side so we never see disabled integrations
  // here — keep the guard anyway as defense in depth.)
  const masterOff = !row.integrationEnabled;
  const blocked = row.blockedByProvider;
  const disabled = (masterOff && !checked) || blocked;
  const reason = blocked
    ? `Another ${row.providerId} key is already linked to this team. Turn it off first.`
    : masterOff
      ? "Disabled on the Integration tab. Re-enable it there to use here."
      : null;
  return (
    <li className="flex items-center gap-3 px-4 py-3">
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
          {reason && ` · ${reason}`}
        </span>
      </div>
      <div className="flex shrink-0 items-center gap-3">
        <Switch
          checked={checked}
          disabled={disabled}
          onCheckedChange={(next) => onToggle(next)}
          aria-label={
            checked
              ? `Unlink ${row.displayName} from this team`
              : `Link ${row.displayName} to this team`
          }
        />
        <span className="w-12 text-right text-[12px] text-text-3">
          {checked ? "Active" : "Inactive"}
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
