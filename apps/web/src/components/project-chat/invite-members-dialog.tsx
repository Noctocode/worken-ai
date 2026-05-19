"use client";

import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, MoreVertical } from "lucide-react";
import { toast } from "sonner";

import {
  Dialog,
  DialogContent,
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

import { EmailTagInput, type EmailTag } from "./email-tag-input";

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
 * Structure mirrors the Figma comp:
 *  - Modal header: title + close (rendered by DialogContent).
 *  - Combined input row: email tags + inline role dropdown share a
 *    single rounded-12px border. Figma renders these as one control
 *    so the role applies "to whatever I'm about to send", which only
 *    reads right when they sit visually inside the same box.
 *  - Full-width primary Send Invite below the combined input.
 *  - Members group: people with team access. Read-only role badge —
 *    role changes for team members belong on /teams/[id], not in a
 *    chat-side dialog.
 *  - Other group: direct project members (project_members table).
 *    Inline role dropdown + kebab Remove.
 *
 * Personal projects (no teamId): skip the invite row and the Members
 * group; only "Other" appears.
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
    const stillInvalid = tags.filter((t) => t.error);
    setTags([...failed, ...stillInvalid]);
    setSending(false);
    if (okCount > 0) {
      toast.success(
        okCount === valid.length
          ? `Invited ${okCount} ${okCount === 1 ? "member" : "members"}.`
          : `Invited ${okCount} of ${valid.length}. Fix the highlighted addresses and retry.`,
      );
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
      <DialogContent className="gap-5 sm:max-w-[640px]">
        <DialogHeader>
          <DialogTitle className="text-[18px] font-bold">
            Invite Team Members
          </DialogTitle>
        </DialogHeader>

        {project.teamId && (
          <div className="flex flex-col gap-2">
            <label className="text-[13px] text-text-3">Invite by email</label>
            {/* Combined input — Figma renders the badges and the role
                dropdown inside a single rounded box. We stack on
                narrow viewports because the role select can't shrink
                below ~110px without losing the chevron. */}
            <div
              className={`flex min-h-[48px] flex-col gap-0 overflow-hidden rounded-xl border border-border-2 bg-bg-white transition-colors focus-within:border-primary-5 focus-within:ring-2 focus-within:ring-primary-5/10 sm:flex-row sm:items-stretch ${
                sending ? "opacity-60" : ""
              }`}
            >
              <div className="min-w-0 flex-1">
                <EmailTagInput
                  tags={tags}
                  onChange={setTags}
                  disabled={sending}
                  borderless
                />
              </div>
              <div className="border-t border-border-2 sm:border-l sm:border-t-0">
                <Select
                  value={inviteRole}
                  onValueChange={(v) => setInviteRole(v as DialogRole)}
                  disabled={sending}
                >
                  <SelectTrigger
                    aria-label="Invite role"
                    className="h-full w-full min-w-[120px] cursor-pointer rounded-none border-0 bg-transparent px-3 text-[13px] text-text-1 focus:ring-0 focus:ring-offset-0 sm:w-[130px]"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="editor">Can Edit</SelectItem>
                    <SelectItem value="admin">Admin</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <Button
              type="button"
              disabled={sending || tags.filter((t) => !t.error).length === 0}
              onClick={handleSend}
              className="w-full bg-primary-6 hover:bg-primary-7"
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
        )}

        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin text-text-3" />
          </div>
        ) : (
          <>
            {project.teamId && (
              <MemberGroup
                title="Members"
                subtitle={project.teamName}
                rows={teamRows}
              />
            )}
            <MemberGroup
              title={project.teamId ? "Other" : "Members"}
              subtitle={null}
              rows={directRows}
              onChangeRole={(userId, role) =>
                roleMutation.mutate({ userId, role })
              }
              onRemove={(userId) => removeMutation.mutate(userId)}
              emptyHint={
                project.teamId
                  ? "No direct invites yet."
                  : "No members yet."
              }
            />
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

interface MemberGroupProps {
  title: string;
  subtitle: string | null;
  rows: ProjectMember[];
  onChangeRole?: (userId: string, role: DialogRole) => void;
  onRemove?: (userId: string) => void;
  emptyHint?: string;
}

function MemberGroup({
  title,
  subtitle,
  rows,
  onChangeRole,
  onRemove,
  emptyHint,
}: MemberGroupProps) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-col">
        <h3 className="text-[14px] font-bold text-text-1">{title}</h3>
        {subtitle && (
          <span className="text-[12px] text-text-3">{subtitle}</span>
        )}
      </div>
      {rows.length === 0 ? (
        <p className="py-1 text-[12px] text-text-3">
          {emptyHint ?? "No members."}
        </p>
      ) : (
        <ul className="flex flex-col">
          {rows.map((m) => (
            <li
              key={m.userId}
              className="flex items-center gap-3 py-2 first:pt-0"
            >
              <Avatar className="h-7 w-7 shrink-0">
                {m.userPicture ? (
                  <AvatarImage src={m.userPicture} alt={m.userName ?? ""} />
                ) : null}
                <AvatarFallback className="bg-primary-1 text-[10px] font-medium text-primary-6">
                  {initials(m.userName, m.userEmail)}
                </AvatarFallback>
              </Avatar>
              <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-text-1">
                {m.userName ?? m.userEmail}
              </span>
              {onChangeRole && (m.role === "admin" || m.role === "editor") ? (
                <Select
                  value={m.role}
                  onValueChange={(v) =>
                    onChangeRole(m.userId, v as DialogRole)
                  }
                >
                  <SelectTrigger
                    aria-label="Role"
                    className="h-7 w-[100px] cursor-pointer border-0 bg-transparent px-2 text-[12px] text-text-2 hover:text-text-1 focus:ring-0 focus:ring-offset-0"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="editor">Can Edit</SelectItem>
                    <SelectItem value="admin">Admin</SelectItem>
                  </SelectContent>
                </Select>
              ) : (
                // Read-only label for team-source rows (role changes
                // belong on /teams/[id], not in a chat-side dialog).
                <span className="text-[12px] text-text-2">
                  {roleLabel(m.role)}
                </span>
              )}
              {onRemove ? (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button
                      type="button"
                      className="inline-flex h-7 w-7 items-center justify-center rounded-md text-text-3 transition-colors hover:bg-bg-1 hover:text-text-1"
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
              ) : (
                // Reserve the kebab slot so team and direct rows align
                // vertically — keeps the action column visually
                // consistent even though team rows have no actions.
                <span className="inline-block h-7 w-7" aria-hidden />
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
