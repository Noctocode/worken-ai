"use client";

import Link from "next/link";
import { MoreVertical, Eye, Crown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { Team } from "@/lib/api";

export function TeamRow({ team, isOwner }: { team: Team; isOwner: boolean }) {
  return (
    <tr className="h-14 border-b border-bg-1 transition-colors hover:bg-slate-50/50">
      <td className="px-4 align-middle text-base font-normal text-black">
        <div className="flex items-center gap-2">
          {team.name}
          {isOwner && (
            <Badge
              variant="secondary"
              className="gap-1 text-[11px] border-amber-200 bg-amber-50 text-amber-700"
            >
              <Crown className="h-3 w-3" />
              Owner
            </Badge>
          )}
        </div>
      </td>
      <td className="px-4 align-middle text-base font-normal text-black">—</td>
      <td className="px-4 align-middle text-base font-normal text-black">—</td>
      <td className="px-4 align-middle text-base font-normal text-black">—</td>
      <td className="px-4 align-middle text-base font-normal text-black">—</td>
      <td className="px-4 align-middle text-base font-normal text-black">—</td>
      <td className="px-4 align-middle text-right">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-slate-400 hover:text-slate-600"
            >
              <MoreVertical className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem asChild>
              <Link href={`/teams/${team.id}`} className="gap-2">
                <Eye className="h-4 w-4" />
                View team
              </Link>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </td>
    </tr>
  );
}
