"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, MoreVertical, Users } from "lucide-react";
import { toast } from "sonner";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  fetchProjectMembers,
  inviteTeamMember,
  removeProjectMember,
  updateProjectMemberRole,
  type Project,
  type ProjectMember,
} from "@/lib/api";

import { EmailTagInput, type EmailTag } from "./email-tag-input.js";

/** "Can Edit" → backend `editor`, "Admin" → backend `admin`. The
 *  Figma 179:16073 design only exposes these two; we treat existing
 *  team rows with manager/viewer roles read-only so we don't
 *  accidentally downgrade them from a chat-side dialog. */
type DialogRole = "admin" | "editor";

function roleLabel(role: string): string {
  switch (role) {
    case "admin":
      return "Admin";
    case "manager":
      return "Manager";
    case "editor":
      return "Can Edit";
    case "viewer":
      return "Viewer";
    default:
      return role;
  }
}

function initials(name: string | null | undefined, email: string): string {
  const base = (name ?? email).trim();
  if (!base) return "?";
  return base
    .split(/\s+/)
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

/**
 * Project-scoped invite + members dialog (Figma 179:16073).
 *
 * Replaces the simpler single-email `InviteMemberDialog` in the
 * Appbar's projectDetail block. Renders three sections:
 *
 *  - Invite row: multi-tag email input + `Can Edit / Admin` role
 *    dropdown + Send Invite button. Each tag becomes a parallel call
 *    to `inviteTeamMember(project.teamId, …)`; failed addresses keep
 *    their badge with a red ring and a tooltip carrying the BE
 *    message so the user can fix and resend.
 *  - Members group: people who have access via the project's team.
 *    Read-only role label + a kebab that routes to /teams/[id] for
 *    role changes / removal — team membership is the source of truth
 *    for those operations.
 *  - Other group: direct project members (project_members table).
 *    Role is editable inline; the kebab has Remove from project.
 *
 * Personal projects skip the invite row and the Members group; only
 * "Other" appears so direct invites are still possible.
 */
export function InviteMembersDialog({
  project,
  children,
}: {
  project: Project;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [tags, setTags] = useState<EmailTag[]>([]);
  const [inviteRole, setInviteRole] = useState<DialogRole>("editor");
  const [sending, setSending] = useState(false);
  const qc = useQueryClient();

  const { data: members = [], isLoading } = useQuery({
    queryKey: ["project-members", project.id],
    queryFn: () => fetchProjectMembers(project.id),
    enabled: open,
  });

  // Reset draft state on every fresh open so a previous failed
  // attempt doesn't leak across sessions.
  useEffect(() => {
    if (!open) {
      setTags([]);
      setInviteRole("editor");
      setSending(false);
    }
  }, [open]);

  const { teamRows, directRows } = useMemo(() => {
    const teamRows: ProjectMember[] = [];
    const directRows: ProjectMember[] = [];
    for (const m of members) {
      if (m.source === "team") teamRows.push(m);
      else directRows.push(m);
    }
    return { teamRows, directRows };
  }, [members]);

  const handleSend = async () => {
    if (!project.teamId) return;
    const valid = tags.filter((t) => !t.error);
    if (valid.length === 0) {
      toast.error("Add at least one valid email.");
      return;
    }
    setSending(true);
    const results = await Promise.allSettled(
      valid.map((t) =>
        inviteTeamMember(project.teamId!, t.value, inviteRole).then(
          () => ({ email: t.value, ok: true as const }),
          (err: Error) => ({
            email: t.value,
            ok: false as const,
            message: err.message,
          }),
        ),
      ),
    );
    const failed: EmailTag[] = [];
    let okCount = 0;
    for (const r of results) {
      if (r.status === "rejected") continue;
      const v = r.value;
      if (v.ok) {
        okCount += 1;
      } else {
        failed.push({ value: v.email, error: v.message });
      }
    }
    // Keep failed tags + any tags the user had typed but didn't
    // commit (those wouldn't have been in `valid`).
    const stillInvalid = tags.filter((t) => t.error);
    setTags([...failed, ...stillInvalid]);
    setSending(false);
    if (okCount > 0) {
      toast.success(
        okCount === valid.length
          ? `Invited ${okCount} ${okCount === 1 ? "member" : "members"}.`
          : `Invited ${okCount} of ${valid.length}. Fix the highlighted addresses and retry.`,
      );
      // Surface new accepted members + propagate to the avatar stack
      // in the Appbar via the project query.
      qc.invalidateQueries({ queryKey: ["project-members", project.id] });
      qc.invalidateQueries({ queryKey: ["teams", project.teamId] });
      qc.invalidateQueries({ queryKey: ["project", project.id] });
    } else {
      toast.error(`None of the invites went through. Check the addresses.`);
    }
  };

  const roleMutation = useMutation({
    mutationFn: ({
      userId,
      role,
    }: {
      userId: string;
      role: DialogRole;
    }) => updateProjectMemberRole(project.id, userId, role),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["project-members", project.id] });
    },
    onError: (err: Error) => {
      toast.error(err.message || "Couldn't update role.");
    },
  });

  const removeMutation = useMutation({
    mutationFn: (userId: string) => removeProjectMember(project.id, userId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["project-members", project.id] });
      toast.success("Removed from project.");
    },
    onError: (err: Error) => {
      toast.error(err.message || "Couldn't remove member.");
    },
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent className="sm:max-w-[560px]">
        <DialogHeader>
          <DialogTitle>Invite Team Members</DialogTitle>
          <DialogDescription>
            Add people to{" "}
            <strong className="font-medium text-text-1">{project.name}</strong>{" "}
            so they can chat alongside you in this project.
          </DialogDescription>
        </DialogHeader>

        {project.teamId && (
          <div className="flex flex-col gap-2">
            <label className="text-[12px] font-medium text-text-2">
              Invite by email
            </label>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-start">
              <div className="flex-1">
                <EmailTagInput
                  tags={tags}
                  onChange={setTags}
                  disabled={sending}
                />
              </div>
              <Select
                value={inviteRole}
                onValueChange={(v) => setInviteRole(v as DialogRole)}
                disabled={sending}
              >
                <SelectTrigger className="h-[44px] w-full shrink-0 cursor-pointer sm:w-[140px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="editor">Can Edit</SelectItem>
                  <SelectItem value="admin">Admin</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex justify-end">
              <Button
                type="button"
                disabled={sending || tags.filter((t) => !t.error).length === 0}
                onClick={handleSend}
                className="bg-primary-6 hover:bg-primary-7"
              >
                {sending ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Sending…
                  </>
                ) : (
                  "Send Invite"
                )}
              </Button>
            </div>
          </div>
        )}

        <div className="flex flex-col gap-3 border-t border-border-2 pt-4">
          {isLoading ? (
            <div className="flex items-center justify-center py-10">
              <Loader2 className="h-5 w-5 animate-spin text-text-3" />
            </div>
          ) : (
            <>
              {project.teamId && (
                <MemberGroup
                  title="Members"
                  subtitle={project.teamName ?? "Team"}
                  rows={teamRows}
                  manageHref={`/teams/${project.teamId}?tab=users`}
                  // Team rows are read-only — the team is the source
                  // of truth, role changes belong on /teams/[id].
                />
              )}
              <MemberGroup
                title={project.teamId ? "Other" : "Members"}
                subtitle={
                  project.teamId
                    ? "People invited to this project directly."
                    : null
                }
                rows={directRows}
                onChangeRole={(userId, role) =>
                  roleMutation.mutate({ userId, role })
                }
                onRemove={(userId) => removeMutation.mutate(userId)}
                emptyMessage={
                  project.teamId
                    ? "No direct invites yet. Add someone with the form above and pick their role."
                    : "No members yet. Direct invites for personal projects are coming soon."
                }
              />
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

interface MemberGroupProps {
  title: string;
  subtitle: string | null;
  rows: ProjectMember[];
  /** When set, this group is interactive: dropdown writes to the
   *  project_members table and the kebab can remove a row. When
   *  unset, the group is read-only and `manageHref` routes to where
   *  the user should manage the rows instead. */
  onChangeRole?: (userId: string, role: DialogRole) => void;
  onRemove?: (userId: string) => void;
  manageHref?: string;
  emptyMessage?: string;
}

function MemberGroup({
  title,
  subtitle,
  rows,
  onChangeRole,
  onRemove,
  manageHref,
  emptyMessage,
}: MemberGroupProps) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-2">
        <div className="flex flex-col">
          <h3 className="text-[14px] font-bold text-text-1">{title}</h3>
          {subtitle && (
            <span className="text-[12px] text-text-3">{subtitle}</span>
          )}
        </div>
        {manageHref && (
          <Link
            href={manageHref}
            className="text-[12px] font-medium text-primary-6 hover:text-primary-7"
          >
            Manage in team
          </Link>
        )}
      </div>
      {rows.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border-2 px-3 py-4 text-center text-[12px] text-text-3">
          {emptyMessage ?? "No members."}
        </p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {rows.map((m) => (
            <li
              key={m.userId}
              className="flex items-center gap-3 rounded-lg border border-border-2 bg-bg-white px-3 py-2"
            >
              <Avatar className="h-8 w-8 shrink-0">
                {m.userPicture ? (
                  <AvatarImage src={m.userPicture} alt={m.userName ?? ""} />
                ) : null}
                <AvatarFallback className="bg-primary-1 text-[11px] font-medium text-primary-6">
                  {initials(m.userName, m.userEmail)}
                </AvatarFallback>
              </Avatar>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13px] font-medium text-text-1">
                  {m.userName ?? m.userEmail}
                </p>
                <p className="truncate text-[11px] text-text-3">
                  {m.userEmail}
                </p>
              </div>
              {onChangeRole && (m.role === "admin" || m.role === "editor") ? (
                <Select
                  value={m.role}
                  onValueChange={(v) =>
                    onChangeRole(m.userId, v as DialogRole)
                  }
                >
                  <SelectTrigger className="h-8 w-[110px] cursor-pointer text-[12px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="editor">Can Edit</SelectItem>
                    <SelectItem value="admin">Admin</SelectItem>
                  </SelectContent>
                </Select>
              ) : (
                <span className="rounded-md bg-bg-1 px-2 py-1 text-[11px] font-medium text-text-2">
                  {roleLabel(m.role)}
                </span>
              )}
              {onRemove && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button
                      type="button"
                      className="inline-flex h-8 w-8 items-center justify-center rounded-md text-text-3 transition-colors hover:bg-bg-1 hover:text-text-1"
                      aria-label="More"
                    >
                      <MoreVertical className="h-4 w-4" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem
                      onClick={() => onRemove(m.userId)}
                      className="text-danger-6 focus:text-danger-6"
                    >
                      Remove from project
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </li>
          ))}
        </ul>
      )}
      {rows.length === 0 && manageHref && (
        <Link
          href={manageHref}
          className="inline-flex items-center gap-1 text-[12px] font-medium text-primary-6 hover:text-primary-7"
        >
          <Users className="h-3 w-3" />
          Open team
        </Link>
      )}
    </div>
  );
}
