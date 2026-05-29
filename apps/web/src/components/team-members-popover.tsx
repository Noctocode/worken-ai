"use client";

import { useState } from "react";
import { Popover } from "radix-ui";
import { CheckCircle, Loader2, X } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { fetchTeam } from "@/lib/api";
import { useLanguage } from "@/lib/i18n";

/**
 * Click-to-open popover listing every accepted + pending member of a
 * team — name, email, role, and an acceptance indicator. Same visual
 * shape as the inline popover on the project detail appbar; lifted
 * into a shared component so the dashboard project cards (avatar
 * stack) can drive the same UX without duplicating the rendering or
 * the data-fetching glue.
 *
 * Data is lazy-fetched on first open and cached by react-query under
 * the same `["teams", teamId]` key that the appbar uses — so opening
 * the popover after viewing the project detail is instant (cache
 * hit), and the first open inside the dashboard does one round-trip.
 *
 * Trigger is `children` so the caller controls the visual (avatar
 * stack on a card, member chip on an appbar, ...). The trigger MUST
 * be focusable / clickable; we don't add our own wrapper button so
 * `asChild` can forward the trigger props onto whatever the caller
 * passed in.
 */
export function TeamMembersPopover({
  teamId,
  children,
}: {
  teamId: string;
  children: React.ReactNode;
}) {
  const { t } = useLanguage();
  const [open, setOpen] = useState(false);
  const { data: team, isLoading } = useQuery({
    queryKey: ["teams", teamId],
    queryFn: () => fetchTeam(teamId),
    enabled: open,
  });
  const members = team?.members ?? [];

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>{children}</Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="start"
          sideOffset={8}
          className="z-50 w-[320px] rounded-lg border border-border-2 bg-bg-white p-4 shadow-lg"
          // Cards live inside a clickable wrapper that navigates to
          // the project — swallow pointer events on the popover so the
          // dialog itself doesn't propagate.
          onClick={(e) => e.stopPropagation()}
        >
          <div className="mb-3 flex items-center justify-between">
            <span className="text-[14px] font-bold text-text-1">
              {t("teamPop.title")} ({members.length})
            </span>
            <Popover.Close asChild>
              <button
                type="button"
                aria-label={t("teamPop.close")}
                className="cursor-pointer text-text-3 hover:text-text-1"
              >
                <X className="h-4 w-4" />
              </button>
            </Popover.Close>
          </div>
          {isLoading && (
            <div className="flex items-center justify-center py-6">
              <Loader2 className="h-4 w-4 animate-spin text-text-3" />
            </div>
          )}
          {!isLoading && members.length === 0 && (
            <p className="py-4 text-center text-[12px] text-text-3">
              {t("teamPop.noMembers")}
            </p>
          )}
          <div className="flex max-h-[300px] flex-col gap-3 overflow-auto">
            {members.map((m) => (
              <div key={m.id} className="flex items-center gap-3">
                {m.userPicture ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={m.userPicture}
                    alt={m.userName ?? ""}
                    className="h-8 w-8 shrink-0 rounded-full object-cover"
                  />
                ) : (
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary-6 text-[12px] font-medium text-white">
                    {(m.userName ?? m.email)?.[0]?.toUpperCase() ?? "?"}
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] font-medium text-text-1">
                    {m.userName ?? m.email}
                  </p>
                  <div className="flex items-center gap-1">
                    <span className="truncate text-[11px] text-text-3">
                      {m.email}
                    </span>
                    {m.status === "accepted" ? (
                      <CheckCircle className="h-3 w-3 shrink-0 text-success-7" />
                    ) : (
                      <span className="shrink-0 rounded bg-warning-2 px-1 py-0.5 text-[10px] font-medium text-warning-5">
                        {t("teamPop.pending")}
                      </span>
                    )}
                  </div>
                </div>
                <span className="shrink-0 text-[11px] capitalize text-text-3">
                  {m.role}
                </span>
              </div>
            ))}
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
