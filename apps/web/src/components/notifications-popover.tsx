"use client";

import Link from "next/link";
import { useState } from "react";
import {
  Bell,
  CheckCheck,
  X,
  Users,
  CircleDollarSign,
  FileWarning,
  FolderOpen,
  Loader2,
  Shield,
} from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  acceptNotification,
  declineNotification,
  dismissNotification,
  fetchNotifications,
  fetchNotificationsUnreadCount,
  markAllNotificationsRead,
  markNotificationRead,
  type Notification,
} from "@/lib/api";
import { cn } from "@/lib/utils";

/**
 * Type-keyed icon picker. Kept inline because the union is small and
 * tying each row to a glyph is the only place we map type → visual.
 */
function NotificationIcon({ type }: { type: Notification["type"] }) {
  if (type === "team_invite" || type === "org_invite") {
    return <Users className="h-4 w-4 text-primary-7" strokeWidth={2} />;
  }
  if (type === "budget_alert") {
    return (
      <CircleDollarSign className="h-4 w-4 text-warning-7" strokeWidth={2} />
    );
  }
  if (
    type === "budget_changed" ||
    type === "account_budget_changed" ||
    type === "member_cap_changed"
  ) {
    // Muted tone — these are informational ("FYI a cap moved"),
    // not threshold warnings.
    return (
      <CircleDollarSign className="h-4 w-4 text-text-3" strokeWidth={2} />
    );
  }
  if (type === "file_ingestion_failed") {
    return (
      <FileWarning className="h-4 w-4 text-warning-7" strokeWidth={2} />
    );
  }
  if (type === "project_created" || type === "project_deleted") {
    return <FolderOpen className="h-4 w-4 text-text-3" strokeWidth={2} />;
  }
  if (type === "guardrail_added") {
    return <Shield className="h-4 w-4 text-text-3" strokeWidth={2} />;
  }
  if (
    type === "team_renamed" ||
    type === "team_role_changed" ||
    type === "team_member_added" ||
    type === "team_member_removed" ||
    type === "team_deleted" ||
    type === "account_role_changed"
  ) {
    // Membership / role changes — Users glyph in muted tone.
    return <Users className="h-4 w-4 text-text-3" strokeWidth={2} />;
  }
  return <Bell className="h-4 w-4 text-text-3" strokeWidth={2} />;
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return "just now";
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day}d ago`;
  return new Date(iso).toLocaleDateString();
}

interface NotificationsPopoverProps {
  /**
   * Render prop for the trigger. Gets the live unread count so the
   * caller can render its own badge in-place — matters because the
   * trigger lives inside layouts (sidebar nav row, appbar icon
   * button) where wrapping it in a positioned span would break
   * width / alignment. Returning a single element keeps Radix's
   * `asChild` happy.
   */
  children: (state: { unreadCount: number }) => React.ReactElement;
}

/**
 * Bell-icon dropdown listing the user's pending + recent
 * notifications. Inline Accept / Decline buttons for team invites;
 * info-only types collapse to a Dismiss X. Polls every 30s while
 * mounted so the badge stays fresh without a websocket.
 */
export function NotificationsPopover({ children }: NotificationsPopoverProps) {
  const [open, setOpen] = useState(false);
  const queryClient = useQueryClient();

  const { data: items = [], isLoading } = useQuery({
    queryKey: ["notifications"],
    queryFn: fetchNotifications,
    // 30s polling matches the bell-badge refresh; pausing when the
    // tab is hidden is the default react-query behaviour, so we
    // don't burn requests in a background tab.
    refetchInterval: 30_000,
  });

  // Bell badge — sourced from a dedicated unread-count endpoint so
  // the bell can mount on every authed page without paying for the
  // full list fetch. Same 30s cadence.
  const { data: unread } = useQuery({
    queryKey: ["notifications", "unread"],
    queryFn: fetchNotificationsUnreadCount,
    refetchInterval: 30_000,
  });
  const unreadCount = unread?.count ?? 0;

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["notifications"] });
    queryClient.invalidateQueries({ queryKey: ["notifications", "unread"] });
  };

  const acceptMutation = useMutation({
    mutationFn: (id: string) => acceptNotification(id),
    onSuccess: () => {
      invalidate();
      // Accepting a team invite changes membership — refresh
      // anything that lists teams the user belongs to.
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
    onSuccess: invalidate,
  });

  // Open-the-popover side effect: flip every visible unread row to
  // read in one batch. Cheaper than per-row markRead clicks and
  // matches the user mental model ("I saw the bell, so I've seen
  // these").
  const handleOpenChange = (next: boolean) => {
    setOpen(next);
    if (next && unreadCount > 0) {
      markAllMutation.mutate();
    }
  };

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>{children({ unreadCount })}</PopoverTrigger>
      <PopoverContent
        // Anchored at the bottom of the sidebar, so opening up + to
        // the right keeps the popup on-screen and away from the row
        // it was triggered from. Radix' collision handler will flip
        // if the screen is too short.
        side="top"
        align="start"
        sideOffset={8}
        className="w-[360px] max-w-[calc(100vw-2rem)] p-0"
      >
        <header className="flex items-center justify-between border-b border-border-2 px-3 py-2">
          <span className="text-[13px] font-semibold text-text-1">
            Notifications
          </span>
          <Link
            href="/notifications"
            className="text-[12px] text-primary-6 hover:text-primary-7"
            onClick={() => setOpen(false)}
          >
            View all
          </Link>
        </header>

        <div className="max-h-[400px] overflow-y-auto">
          {isLoading ? (
            <div className="flex items-center justify-center px-3 py-8 text-[12px] text-text-3">
              <Loader2 className="mr-2 h-3 w-3 animate-spin" />
              Loading…
            </div>
          ) : items.length === 0 ? (
            <div className="px-3 py-8 text-center text-[12px] text-text-3">
              You&rsquo;re all caught up.
            </div>
          ) : (
            <ul className="divide-y divide-border-2">
              {items.slice(0, 10).map((n) => (
                <li
                  key={n.id}
                  className={cn(
                    "flex items-start gap-2 px-3 py-2.5",
                    n.readAt == null && "bg-primary-1/40",
                  )}
                >
                  <span className="mt-0.5">
                    <NotificationIcon type={n.type} />
                  </span>
                  <div className="flex flex-1 flex-col gap-1 min-w-0">
                    <p className="text-[13px] font-medium text-text-1">
                      {n.title}
                    </p>
                    {n.body && (
                      <p className="text-[12px] text-text-2">{n.body}</p>
                    )}
                    <span className="text-[11px] text-text-3">
                      {relativeTime(n.createdAt)}
                    </span>
                    {/* Action row — team_invite is the only type
                        with Accept/Decline today. Other types show
                        a passive "Dismiss" since there's nothing to
                        confirm. Pending status drives whether the
                        buttons are even meaningful. */}
                    {n.status === "pending" && n.type === "team_invite" && (
                      <div className="mt-1 flex gap-2">
                        <button
                          type="button"
                          disabled={acceptMutation.isPending}
                          onClick={() => acceptMutation.mutate(n.id)}
                          className="cursor-pointer rounded bg-primary-6 px-2 py-1 text-[12px] font-medium text-white hover:bg-primary-7 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          Accept
                        </button>
                        <button
                          type="button"
                          disabled={declineMutation.isPending}
                          onClick={() => declineMutation.mutate(n.id)}
                          className="cursor-pointer rounded border border-border-3 px-2 py-1 text-[12px] font-medium text-text-1 hover:bg-bg-1 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          Decline
                        </button>
                      </div>
                    )}
                  </div>
                  <div className="flex shrink-0 gap-1">
                    {n.readAt == null && (
                      <button
                        type="button"
                        title="Mark read"
                        aria-label="Mark read"
                        onClick={() => markReadMutation.mutate(n.id)}
                        className="flex h-5 w-5 cursor-pointer items-center justify-center rounded text-text-3 hover:bg-bg-1 hover:text-text-1"
                      >
                        <CheckCheck className="h-3 w-3" />
                      </button>
                    )}
                    <button
                      type="button"
                      title="Dismiss"
                      aria-label="Dismiss"
                      onClick={() => dismissMutation.mutate(n.id)}
                      className="flex h-5 w-5 cursor-pointer items-center justify-center rounded text-text-3 hover:bg-bg-1 hover:text-text-1"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
