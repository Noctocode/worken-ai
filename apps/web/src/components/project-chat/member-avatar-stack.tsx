"use client";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import type { ProjectMemberPreview } from "@/lib/api";

function initials(name: string | null | undefined) {
  if (!name) return "?";
  return name
    .split(" ")
    .map((w) => w[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

/**
 * Overlapping avatars for the chat header. Visible count is capped at
 * `max`; if there are more members on the project's team than that, a
 * "+N" pill is appended. The full member list is on /teams/[id], so
 * this is purely a presence indicator on the chat header.
 */
export function MemberAvatarStack({
  members,
  totalCount,
  max = 4,
}: {
  members: ProjectMemberPreview[];
  totalCount: number;
  max?: number;
}) {
  const visible = members.slice(0, max);
  const remainder = Math.max(0, totalCount - visible.length);
  if (visible.length === 0) return null;
  return (
    <div className="flex items-center">
      <div className="flex items-center -space-x-2">
        {visible.map((m) => (
          <Avatar
            key={m.id}
            className="h-7 w-7 border-2 border-bg-white shadow-sm"
            title={m.userName ?? undefined}
          >
            {m.userPicture ? (
              <AvatarImage src={m.userPicture} alt={m.userName ?? ""} />
            ) : null}
            <AvatarFallback className="bg-primary-1 text-[10px] font-medium text-primary-6">
              {initials(m.userName)}
            </AvatarFallback>
          </Avatar>
        ))}
      </div>
      {remainder > 0 && (
        <span className="ml-1 text-[11px] font-medium text-text-3">
          +{remainder}
        </span>
      )}
    </div>
  );
}
