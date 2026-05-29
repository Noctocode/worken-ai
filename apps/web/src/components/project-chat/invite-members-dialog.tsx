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
  inviteProjectMemberByEmail,
  removeProjectMember,
  updateProjectMemberRole,
  type Project,
  type ProjectMember,
} from "@/lib/api";

import { EmailTagInput, type EmailTag } from "./email-tag-input";
import { useLanguage } from "@/lib/i18n";
import type { TranslationKey } from "@/lib/translations/en";

/** Project-level roles for the invite row. The invite path now
 *  writes to `project_members` (NOT team_members), so the role
 *  vocabulary is admin / editor / viewer — `manager` is a team-
 *  scoped role that has no place at the project level. */
type InviteRole = "admin" | "editor" | "viewer";

/** Subset writable on the per-row dropdown inside the Other group.
 *  Viewer is read-only-ish today (no role-bump UI) but valid in
 *  project_members; we expose it on invite but not on the inline
 *  per-row dropdown to keep that control compact. */
type DialogRole = "admin" | "editor";

function roleLabel(role: string, t: (k: TranslationKey) => string): string {
  switch (role) {
    case "admin":
      return t("invMem.roleAdmin");
    case "manager":
      return t("invMem.roleManager");
    case "editor":
      return t("invMem.roleEditor");
    case "viewer":
      return t("invMem.roleViewer");
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
 * Personal projects (no `teamId`) skip the invite row entirely and
 * render only the direct-members group. That group currently just
 * shows a "coming soon" placeholder — direct invites for personal
 * projects are not wired up yet.
 */
export function InviteMembersDialog({
  project,
  children,
}: {
  project: Project;
  children: React.ReactNode;
}) {
  const { t } = useLanguage();
  const [open, setOpen] = useState(false);
  const [tags, setTags] = useState<EmailTag[]>([]);
  const [inviteRole, setInviteRole] = useState<InviteRole>("editor");
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
    const valid = tags.filter((tag) => !tag.error);
    if (valid.length === 0) {
      toast.error(t("invMem.addValid"));
      return;
    }
    setSending(true);
    // Single-shot per address: the new
    // POST /projects/:id/members/invite endpoint creates the org
    // user if needed (with the caller's company tenancy inherited)
    // AND inserts a project_members row. No team membership is
    // touched, so the invitee shows under Other immediately, and
    // they also land in /teams?tab=users.
    const results = await Promise.allSettled(
      valid.map((tag) =>
        inviteProjectMemberByEmail(project.id, tag.value, inviteRole).then(
          () => ({ email: tag.value, ok: true as const }),
          (err: Error) => ({
            email: tag.value,
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
    const stillInvalid = tags.filter((tag) => tag.error);
    setTags([...failed, ...stillInvalid]);
    setSending(false);
    if (okCount > 0) {
      toast.success(
        okCount === valid.length
          ? `${t("invMem.invitedN1")} ${okCount} ${okCount === 1 ? t("invMem.member") : t("invMem.members")}.`
          : t("invMem.invitedPartial").replace("{ok}", String(okCount)).replace("{total}", String(valid.length)),
      );
      // Surface new accepted members. We don't touch team queries
      // anymore (no team-invite happens), but we still invalidate
      // the project query so any FE-cached project-team-members
      // count stays consistent if it ever incorporates direct rows.
      qc.invalidateQueries({ queryKey: ["project-members", project.id] });
      qc.invalidateQueries({ queryKey: ["project", project.id] });
      // Org-users list (drives /teams?tab=users) — refresh so the
      // newly-created pending row shows up there too.
      qc.invalidateQueries({ queryKey: ["org-users"] });
    } else {
      toast.error(t("invMem.noneWent"));
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
      toast.error(err.message || t("invMem.couldntUpdateRole"));
    },
  });

  const removeMutation = useMutation({
    mutationFn: (userId: string) => removeProjectMember(project.id, userId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["project-members", project.id] });
      toast.success(t("invMem.removedFromProject"));
    },
    onError: (err: Error) => {
      toast.error(err.message || t("invMem.couldntRemove"));
    },
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent className="sm:max-w-[560px]">
        <DialogHeader>
          <DialogTitle>{t("invMem.title")}</DialogTitle>
          <DialogDescription>
            {t("invMem.descPrefix")}{" "}
            <strong className="font-medium text-text-1">{project.name}</strong>{" "}
            {t("invMem.descSuffix")}
          </DialogDescription>
        </DialogHeader>

        {project.teamId && (
          <div className="flex flex-col gap-2">
            <label className="text-[12px] font-medium text-text-2">
              {t("invMem.inviteByEmail")}
            </label>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-stretch">
              <div className="flex-1">
                <EmailTagInput
                  tags={tags}
                  onChange={setTags}
                  disabled={sending}
                />
              </div>
              <Select
                value={inviteRole}
                onValueChange={(v) => setInviteRole(v as InviteRole)}
                disabled={sending}
              >
                {/* `data-[size=default]:h-9` in the shadcn SelectTrigger
                    locks the trigger at 36px; we want it to match the
                    EmailTagInput's 44px (and grow alongside when tags
                    wrap). `!h-auto` cancels the data-attr lock so the
                    flex `items-stretch` parent gets to decide the
                    height for real. */}
                <SelectTrigger className="!h-auto w-full shrink-0 cursor-pointer rounded-xl sm:w-[140px]">
                  <SelectValue />
                </SelectTrigger>
                {/* Project-level roles (Admin / Editor / Viewer).
                    Manager is intentionally absent — it's a team
                    role and the new invite path writes to
                    project_members, not team_members. */}
                <SelectContent>
                  <SelectItem value="admin">{t("invMem.roleAdmin")}</SelectItem>
                  <SelectItem value="editor">{t("invMem.roleEditor")}</SelectItem>
                  <SelectItem value="viewer">{t("invMem.roleViewer")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Button
              type="button"
              disabled={sending || tags.filter((tag) => !tag.error).length === 0}
              onClick={handleSend}
              // Full-width + h-[44px] so the three stacked controls
              // (input, role dropdown, send) all share the same height
              // and gutter.
              className="!h-[44px] w-full rounded-xl bg-primary-6 hover:bg-primary-7"
            >
              {sending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  {t("invMem.sending")}
                </>
              ) : (
                t("invMem.sendInvite")
              )}
            </Button>
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
                  title={t("invMem.membersTitle")}
                  subtitle={project.teamName ?? t("invMem.team")}
                  rows={teamRows}
                  manageHref={`/teams/${project.teamId}?tab=users`}
                  // Team rows are read-only — the team is the source
                  // of truth, role changes belong on /teams/[id].
                />
              )}
              <MemberGroup
                title={project.teamId ? t("invMem.other") : t("invMem.membersTitle")}
                subtitle={
                  project.teamId
                    ? t("invMem.directDesc")
                    : null
                }
                rows={directRows}
                onChangeRole={(userId, role) =>
                  roleMutation.mutate({ userId, role })
                }
                onRemove={(userId) => removeMutation.mutate(userId)}
                emptyMessage={
                  project.teamId
                    ? t("invMem.noDirect")
                    : t("invMem.directComingSoon")
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
  const { t } = useLanguage();
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
            {t("invMem.manageInTeam")}
          </Link>
        )}
      </div>
      {rows.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border-2 px-3 py-4 text-center text-[12px] text-text-3">
          {emptyMessage ?? t("invMem.noMembers")}
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
                <p className="flex items-center gap-1.5 truncate text-[11px] text-text-3">
                  <span className="truncate">{m.userEmail}</span>
                  {m.status === "pending" && (
                    <span className="shrink-0 rounded-sm bg-warning-1 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-warning-7">
                      {t("invMem.pending")}
                    </span>
                  )}
                </p>
              </div>
              {/* Synthetic team-pending rows (id starts with
                  `invite:`) can't have their role changed inline —
                  the team_members row is the source of truth and
                  resending the invite is the right edit. Direct
                  project_members rows whose underlying user is still
                  in signup limbo (status='pending') CAN have their
                  role edited because the row is real and the FE
                  call still resolves to a valid userId. */}
              {onChangeRole &&
              !m.userId.startsWith("invite:") &&
              (m.role === "admin" || m.role === "editor") ? (
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
                    <SelectItem value="admin">{t("invMem.roleAdmin")}</SelectItem>
                    <SelectItem value="editor">{t("invMem.roleEditor")}</SelectItem>
                  </SelectContent>
                </Select>
              ) : (
                <span className="rounded-md bg-bg-1 px-2 py-1 text-[11px] font-medium text-text-2">
                  {roleLabel(m.role, t)}
                </span>
              )}
              {/* Remove fires DELETE /projects/:id/members/:userId.
                  Hide it for synthetic team-pending rows (their userId
                  is `invite:<row>` and can't be deleted via that
                  route — the team page handles team-invite cancels).
                  Direct rows with status='pending' (user still
                  finishing signup) keep the action because the
                  project_members row IS real and can be removed. */}
              {onRemove && !m.userId.startsWith("invite:") && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button
                      type="button"
                      className="inline-flex h-8 w-8 items-center justify-center rounded-md text-text-3 transition-colors hover:bg-bg-1 hover:text-text-1"
                      aria-label={t("invMem.more")}
                    >
                      <MoreVertical className="h-4 w-4" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem
                      onClick={() => onRemove(m.userId)}
                      className="text-danger-6 focus:text-danger-6"
                    >
                      {t("invMem.removeFromProject")}
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
          {t("invMem.openTeam")}
        </Link>
      )}
    </div>
  );
}
