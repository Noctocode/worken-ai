"use client";

import { MoreVertical, UserX } from "lucide-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { removeOrgUser, type OrgUser } from "@/lib/api";
import { formatCurrency } from "@/lib/utils";

function SpentBar({ spent, budget }: { spent: number; budget: number }) {
  const pct = budget > 0 ? Math.min((spent / budget) * 100, 100) : 0;
  const exceeded = spent > budget;
  return (
    <div className="h-[7px] w-[44px] shrink-0 rounded-full bg-bg-3 outline outline-1 outline-border-4 overflow-hidden">
      <div
        className={`h-full rounded-full ${exceeded ? "bg-danger-5" : "bg-success-2"}`}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

export function UserRow({ user }: { user: OrgUser }) {
  const queryClient = useQueryClient();

  const removeMutation = useMutation({
    mutationFn: () => removeOrgUser(user.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["org-users"] });
    },
  });

  const budget = user.monthlyBudget ?? 0;
  const spent = user.spent ?? 0;
  const remaining = budget - spent;
  const projected = user.projected ?? 0;
  const overBudget = projected > budget;

  return (
    <tr className="h-14 border-b border-bg-1 transition-colors hover:bg-slate-50/50">
      {/* Name */}
      <td className="px-4 align-middle text-base font-normal text-black">
        <div className="flex items-center gap-2">
          {user.picture ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={user.picture}
              alt={user.name ?? user.email}
              className="h-7 w-7 rounded-full object-cover"
            />
          ) : (
            <div className="flex h-7 w-7 items-center justify-center rounded-full bg-slate-100 text-[11px] font-semibold text-slate-500">
              {(user.name ?? user.email).charAt(0).toUpperCase()}
            </div>
          )}
          <span>{user.name ?? "—"}</span>
        </div>
      </td>
      {/* Email */}
      <td className="px-4 align-middle text-base font-normal text-black">
        {user.email}
      </td>
      {/* Teams */}
      <td className="px-4 align-middle">
        <div className="flex flex-wrap gap-1">
          {user.teams && user.teams.length > 0 ? (
            user.teams.map((t) => (
              <span
                key={t}
                className="rounded-sm bg-slate-100 px-1.5 py-0.5 text-[12px] text-slate-600"
              >
                {t}
              </span>
            ))
          ) : (
            <span className="text-slate-400">—</span>
          )}
        </div>
      </td>
      {/* Personal Monthly Budget */}
      <td className="px-4 align-middle text-base font-normal text-black">
        {budget > 0 ? formatCurrency(budget) : "—"}
      </td>
      {/* Spent / Remaining */}
      <td className="px-4 align-middle">
        {budget > 0 ? (
          <div className="grid grid-cols-[110px_auto] items-center gap-2">
            <span className="text-sm leading-tight text-black">
              {formatCurrency(spent)} /{" "}
              {remaining < 0 ? (
                <span className="text-danger-5">{formatCurrency(remaining)}</span>
              ) : (
                formatCurrency(remaining)
              )}
            </span>
            <SpentBar spent={spent} budget={budget} />
          </div>
        ) : (
          "—"
        )}
      </td>
      {/* Projected */}
      <td className="px-4 align-middle">
        <div className="flex items-center gap-1.5">
          <span className="text-sm text-black">{formatCurrency(projected)}</span>
          {overBudget ? (
            <span className="rounded-sm bg-bg-1 px-1.5 py-0.5 text-[11px] font-medium text-text-3">
              Over Budget
            </span>
          ) : budget > 0 ? (
            <span className="rounded-sm bg-success-1 px-1.5 py-0.5 text-[11px] font-medium text-text-1">
              On track
            </span>
          ) : null}
        </div>
      </td>
      {/* Actions */}
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
            <DropdownMenuItem
              className="gap-2 text-red-600 focus:text-red-600"
              disabled={removeMutation.isPending}
              onClick={() => removeMutation.mutate()}
            >
              <UserX className="h-4 w-4" />
              Remove user
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </td>
    </tr>
  );
}