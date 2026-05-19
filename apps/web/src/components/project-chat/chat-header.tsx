"use client";

import Link from "next/link";
import { ArrowLeft, Plus, Sparkles, Users } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { InviteMemberDialog } from "@/components/invite-member-dialog";
import { useUserModels } from "@/lib/hooks/use-user-models";
import type { Project } from "@/lib/api";

import { MemberAvatarStack } from "./member-avatar-stack";

interface Props {
  project: Project;
  onChangeModel: (next: string) => void;
  isChangingModel: boolean;
}

/**
 * Header for the per-project chat page.
 *
 * Composition mirrors the Figma `Chat` frames (250:21487, 30:10464,
 * 177:7638): on the left we keep the existing back arrow + project
 * name + model picker, and (for team-scoped projects only) tag the
 * title with a coral "team" chip. On the right, again only for team
 * projects, the avatar stack + Invite Member button surface the
 * project's team membership directly on the chat surface — the user
 * shouldn't have to leave the chat to see who's in the room or pull
 * someone else in.
 *
 * Personal projects keep the original lean layout (back + title +
 * model) to avoid taking up vertical space with chrome that doesn't
 * apply.
 */
export function ChatHeader({ project, onChangeModel, isChangingModel }: Props) {
  const { effective: effectiveModels, getLabel: getModelLabel } = useUserModels();

  const labelWithRouting = (id: string): string => {
    const m = effectiveModels.find((x) => x.id === id);
    const base = m?.name ?? getModelLabel(id);
    if (!m) return base;
    if (m.routing === "byok") return `${base} (BYOK)`;
    if (m.routing === "custom") return `${base} (Custom)`;
    return base;
  };

  const isTeamProject = !!project.teamId;
  const members = project.teamMembers ?? [];
  const totalMembers = project.teamMembersCount ?? members.length;

  return (
    <div className="flex h-14 shrink-0 items-center justify-between gap-3 border-b border-border-2 bg-bg-white/60 px-4 backdrop-blur-md sm:px-6">
      <div className="flex min-w-0 items-center gap-3">
        <Link href="/">
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 shrink-0 text-text-2 hover:text-text-1"
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <div className="h-4 w-px shrink-0 bg-border-2" />
        <h1 className="truncate text-sm font-semibold text-text-1">
          {project.name}
        </h1>
        {isTeamProject && (
          // Coral pill matches Figma 250:21487 `Badge` (#FFECE8/#CB272D).
          // Surfaces immediately next to the title so a user landing
          // here can tell at a glance that any message they send is
          // visible to the rest of the project's team.
          <span className="inline-flex shrink-0 items-center gap-1 rounded-md bg-danger-1 px-2 py-0.5 text-[11px] font-medium text-danger-6">
            <Users className="h-3 w-3" />
            team
          </span>
        )}
        <Select
          value={project.model}
          onValueChange={(next) => {
            if (next && next !== project.model) {
              onChangeModel(next);
            }
          }}
          disabled={isChangingModel}
        >
          <SelectTrigger
            aria-label="Change project model"
            className="h-8 w-auto shrink-0 gap-1 border-border-2 bg-bg-1 px-2.5 text-xs font-medium text-text-2 hover:text-text-1 focus:ring-0 focus:ring-offset-0"
          >
            <Sparkles className="h-3 w-3" />
            <SelectValue>{labelWithRouting(project.model)}</SelectValue>
          </SelectTrigger>
          <SelectContent align="end" className="max-h-[320px]">
            {/* If the project's current model is no longer in the
                effective list (stale slug, e.g. an old default that
                stopped resolving), surface it disabled at the top so
                the picker still reflects the stored value and the
                user has a clear "switch off this" affordance. */}
            {!effectiveModels.some((m) => m.id === project.model) && (
              <SelectItem value={project.model} disabled>
                {project.model} (unavailable)
              </SelectItem>
            )}
            {effectiveModels.map((m) => (
              <SelectItem key={m.id} value={m.id}>
                {labelWithRouting(m.id)}
              </SelectItem>
            ))}
            {effectiveModels.length === 0 && (
              <div className="px-3 py-2 text-xs text-text-3">
                No models available yet.
              </div>
            )}
          </SelectContent>
        </Select>
      </div>

      {isTeamProject && project.teamId && (
        <div className="hidden items-center gap-3 sm:flex">
          <MemberAvatarStack members={members} totalCount={totalMembers} />
          {/* BE re-validates permission inside inviteTeamMember, so we
              don't gate the trigger client-side — viewers who click
              get a toast'd 403, which beats a silently missing button. */}
          <InviteMemberDialog teamId={project.teamId}>
            <Button
              variant="plusAction"
              className="h-9 gap-1.5 px-3 text-[13px]"
            >
              <Plus className="h-4 w-4" />
              Invite Member
            </Button>
          </InviteMemberDialog>
        </div>
      )}
    </div>
  );
}
