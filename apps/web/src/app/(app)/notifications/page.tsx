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

  return (
    <div className="flex flex-col gap-4 p-6">
      <header className="flex items-center justify-between">
        <div className="flex flex-col gap-1">
          <h1 className="text-[24px] font-bold text-text-1">Notifications</h1>
          <p className="text-[13px] text-text-3">
            Team invitations, role changes, and budget alerts — all in one
            place. Email keeps firing in parallel as a backup.
          </p>
        </div>
        <button
          type="button"
          onClick={() => markAllMutation.mutate()}
          disabled={
            markAllMutation.isPending ||
            items.every((n) => n.readAt != null)
          }
          className="flex items-center gap-1.5 cursor-pointer rounded-md border border-border-3 px-3 py-1.5 text-[13px] text-text-1 hover:bg-bg-1 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <CheckCheck className="h-3.5 w-3.5" />
          Mark all read
        </button>
      </header>

      <div className="flex gap-2">
        {(["all", "unread", "actionable"] as Filter[]).map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => setFilter(f)}
            className={cn(
              "cursor-pointer rounded-md border px-3 py-1 text-[13px]",
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

      <div className="rounded-lg border border-border-2 bg-bg-white">
        {isLoading ? (
          <div className="flex items-center justify-center px-4 py-12 text-text-3">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            Loading…
          </div>
        ) : filtered.length === 0 ? (
          <div className="px-4 py-12 text-center text-text-3">
            {filter === "all"
              ? "You're all caught up."
              : filter === "unread"
                ? "No unread notifications."
                : "No invitations waiting on you."}
          </div>
        ) : (
          <ul className="divide-y divide-border-2">
            {filtered.map((n) => (
              <li
                key={n.id}
                className={cn(
                  "flex items-start gap-3 px-4 py-3",
                  n.readAt == null && "bg-primary-1/40",
                )}
              >
                <span className="mt-0.5">
                  <NotificationIcon type={n.type} />
                </span>
                <div className="flex flex-1 flex-col gap-1 min-w-0">
                  <p className="text-[14px] font-medium text-text-1">
                    {n.title}
                  </p>
                  {n.body && (
                    <p className="text-[13px] text-text-2">{n.body}</p>
                  )}
                  <span className="text-[11px] text-text-3">
                    {formatFull(n.createdAt)}
                  </span>
                  {n.status === "pending" && n.type === "team_invite" && (
                    <div className="mt-2 flex gap-2">
                      <button
                        type="button"
                        disabled={acceptMutation.isPending}
                        onClick={() => acceptMutation.mutate(n.id)}
                        className="cursor-pointer rounded bg-primary-6 px-3 py-1.5 text-[13px] font-medium text-white hover:bg-primary-7 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        Accept
                      </button>
                      <button
                        type="button"
                        disabled={declineMutation.isPending}
                        onClick={() => declineMutation.mutate(n.id)}
                        className="cursor-pointer rounded border border-border-3 px-3 py-1.5 text-[13px] font-medium text-text-1 hover:bg-bg-1 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        Decline
                      </button>
                    </div>
                  )}
                  {n.status === "acted" && (
                    <span className="mt-1 text-[11px] text-text-3 italic">
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
                      className="flex h-6 w-6 cursor-pointer items-center justify-center rounded text-text-3 hover:bg-bg-1 hover:text-text-1"
                    >
                      <CheckCheck className="h-3.5 w-3.5" />
                    </button>
                  )}
                  <button
                    type="button"
                    title="Dismiss"
                    aria-label="Dismiss"
                    onClick={() => dismissMutation.mutate(n.id)}
                    className="flex h-6 w-6 cursor-pointer items-center justify-center rounded text-text-3 hover:bg-bg-1 hover:text-text-1"
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
