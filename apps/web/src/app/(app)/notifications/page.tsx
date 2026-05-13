"use client";

import { useMemo, useState } from "react";
import {
  Bell,
  CheckCheck,
  CircleDollarSign,
  Loader2,
  Users,
  X,
} from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  acceptNotification,
  declineNotification,
  dismissNotification,
  fetchNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  type Notification,
} from "@/lib/api";
import { cn } from "@/lib/utils";

type Filter = "all" | "unread" | "actionable";

function NotificationIcon({ type }: { type: Notification["type"] }) {
  if (type === "team_invite" || type === "org_invite") {
    return <Users className="h-4 w-4 text-primary-7" strokeWidth={2} />;
  }
  if (type === "budget_alert") {
    return (
      <CircleDollarSign className="h-4 w-4 text-warning-7" strokeWidth={2} />
    );
  }
  if (type === "budget_changed") {
    return (
      <CircleDollarSign className="h-4 w-4 text-text-3" strokeWidth={2} />
    );
  }
  if (type === "team_renamed" || type === "team_role_changed") {
    return <Users className="h-4 w-4 text-text-3" strokeWidth={2} />;
  }
  return <Bell className="h-4 w-4 text-text-3" strokeWidth={2} />;
}

function formatFull(iso: string): string {
  return new Date(iso).toLocaleString();
}

/**
 * Full-page notification history. Mirrors the popover with more
 * room: filters across the top, full-width rows, no truncation on
 * the list. Used when the user clicks "View all" in the sidebar
 * popover.
 */
export default function NotificationsPage() {
  const [filter, setFilter] = useState<Filter>("all");
  const queryClient = useQueryClient();

  const { data: items = [], isLoading } = useQuery({
    queryKey: ["notifications"],
    queryFn: fetchNotifications,
  });

  const filtered = useMemo(() => {
    if (filter === "unread") return items.filter((n) => n.readAt == null);
    if (filter === "actionable")
      return items.filter(
        (n) => n.status === "pending" && n.type === "team_invite",
      );
    return items;
  }, [items, filter]);

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ["notifications"] });

  const acceptMutation = useMutation({
    mutationFn: (id: string) => acceptNotification(id),
    onSuccess: () => {
      invalidate();
      queryClient.invalidateQueries({ queryKey: ["teams"] });
      toast.success("Invitation accepted.");
    },
    onError: (err: Error) =>
      toast.error(err.message || "Failed to accept."),
  });
  const declineMutation = useMutation({
    mutationFn: (id: string) => declineNotification(id),
    onSuccess: () => {
      invalidate();
      toast.success("Invitation declined.");
    },
    onError: (err: Error) =>
      toast.error(err.message || "Failed to decline."),
  });
  const dismissMutation = useMutation({
    mutationFn: (id: string) => dismissNotification(id),
    onSuccess: invalidate,
  });
  const markReadMutation = useMutation({
    mutationFn: (id: string) => markNotificationRead(id),
    onSuccess: invalidate,
  });
  const markAllMutation = useMutation({
    mutationFn: () => markAllNotificationsRead(),
    onSuccess: () => {
      invalidate();
      toast.success("All notifications marked as read.");
    },
  });

  const allRead = items.every((n) => n.readAt != null);

  return (
    <div className="flex flex-col gap-4 pt-4">
      {/* Filters + bulk action row. Filters wrap to a new line on
          narrow screens; the action button keeps its right alignment
          via flex-wrap + justify-between behaviour. Title comes from
          the appbar, so no <h1> here. */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2">
          {(["all", "unread", "actionable"] as Filter[]).map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => setFilter(f)}
              className={cn(
                "cursor-pointer rounded-lg border px-3 py-1.5 text-[13px] transition-colors",
                filter === f
                  ? "border-primary-6 bg-primary-1 text-primary-7"
                  : "border-border-3 bg-bg-white text-text-2 hover:bg-bg-1",
              )}
            >
              {f === "all"
                ? "All"
                : f === "unread"
                  ? "Unread"
                  : "Needs action"}
            </button>
          ))}
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => markAllMutation.mutate()}
          disabled={markAllMutation.isPending || allRead}
          className="cursor-pointer gap-1.5 rounded-lg"
        >
          <CheckCheck className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">Mark all read</span>
          <span className="sm:hidden">Read all</span>
        </Button>
      </div>

      {/* Main list card — matches the surface treatment used on
          /guardrails, /knowledge-core, etc: rounded-[20px], white
          background, no border (the shadow + radius do the lift). */}
      <div className="overflow-hidden rounded-[20px] bg-bg-white shadow-[0_1px_3px_rgba(0,0,0,0.06)]">
        {isLoading ? (
          <div className="flex items-center justify-center px-4 py-16 text-[13px] text-text-3">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            Loading…
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center gap-2 px-4 py-16 text-center text-text-3">
            <Bell className="h-6 w-6 text-text-3" />
            <p className="text-[14px]">
              {filter === "all"
                ? "You're all caught up."
                : filter === "unread"
                  ? "No unread notifications."
                  : "No invitations waiting on you."}
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-border-2">
            {filtered.map((n) => (
              <li
                key={n.id}
                className={cn(
                  "flex items-start gap-3 px-4 py-3 sm:px-5 sm:py-4",
                  n.readAt == null && "bg-primary-1/30",
                )}
              >
                <span className="mt-0.5 shrink-0">
                  <NotificationIcon type={n.type} />
                </span>
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <p className="text-[14px] font-medium text-text-1">
                    {n.title}
                  </p>
                  {n.body && (
                    <p className="text-[13px] text-text-2 whitespace-pre-line break-words">
                      {n.body}
                    </p>
                  )}
                  <span className="text-[11px] text-text-3">
                    {formatFull(n.createdAt)}
                  </span>
                  {n.status === "pending" && n.type === "team_invite" && (
                    <div className="mt-2 flex flex-wrap gap-2">
                      <Button
                        size="sm"
                        disabled={acceptMutation.isPending}
                        onClick={() => acceptMutation.mutate(n.id)}
                        className="cursor-pointer rounded-lg bg-primary-6 text-white hover:bg-primary-7"
                      >
                        Accept
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={declineMutation.isPending}
                        onClick={() => declineMutation.mutate(n.id)}
                        className="cursor-pointer rounded-lg"
                      >
                        Decline
                      </Button>
                    </div>
                  )}
                  {n.status === "acted" && (
                    <span className="mt-1 text-[11px] italic text-text-3">
                      Resolved
                    </span>
                  )}
                </div>
                <div className="flex shrink-0 gap-1">
                  {n.readAt == null && (
                    <button
                      type="button"
                      title="Mark read"
                      aria-label="Mark read"
                      onClick={() => markReadMutation.mutate(n.id)}
                      className="flex h-7 w-7 cursor-pointer items-center justify-center rounded-md text-text-3 hover:bg-bg-1 hover:text-text-1"
                    >
                      <CheckCheck className="h-3.5 w-3.5" />
                    </button>
                  )}
                  <button
                    type="button"
                    title="Dismiss"
                    aria-label="Dismiss"
                    onClick={() => dismissMutation.mutate(n.id)}
                    className="flex h-7 w-7 cursor-pointer items-center justify-center rounded-md text-text-3 hover:bg-bg-1 hover:text-text-1"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
