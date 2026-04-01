"use client";

import { MoreVertical, Eye, Trash2, Bot } from "lucide-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Switch } from "@/components/ui/switch";
import { updateModel, deleteModel, type ModelConfig } from "@/lib/api";

export function ModelRow({ model }: { model: ModelConfig }) {
  const queryClient = useQueryClient();

  const toggleMutation = useMutation({
    mutationFn: () => updateModel(model.id, { isActive: !model.isActive }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["models"] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () => deleteModel(model.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["models"] });
    },
  });

  const fallbacks = (model.fallbackModels ?? []) as string[];

  return (
    <tr className="h-14 border-b border-bg-1 transition-colors hover:bg-slate-50/50">
      {/* Custom Name */}
      <td className="px-4 align-middle text-base font-normal text-black whitespace-nowrap">
        {model.customName}
      </td>
      {/* Status */}
      <td className="px-4 align-middle">
        <div className="flex items-center gap-2 min-w-[100px]">
          <Switch
            checked={model.isActive}
            onCheckedChange={() => toggleMutation.mutate()}
            disabled={toggleMutation.isPending}
          />
          <span className="text-sm text-black-700 whitespace-nowrap">
            {model.isActive ? "Active" : "Inactive"}
          </span>
        </div>
      </td>
      {/* Model */}
      <td className="px-4 align-middle whitespace-nowrap">
        <div className="flex items-center gap-1.5">
          <Bot className="h-4 w-4 text-slate-400 shrink-0" />
          <span className="text-base font-normal text-black">
            {model.modelIdentifier}
          </span>
        </div>
      </td>
      {/* Fallback models */}
      <td className="px-4 align-middle">
        <div className="flex items-center gap-1.5 flex-wrap">
          {fallbacks.length > 0 ? (
            fallbacks.map((fb) => (
              <span
                key={fb}
                className="flex items-center gap-1 rounded-full border border-slate-200 bg-slate-50 px-2.5 py-0.5 text-[12px] text-slate-700 whitespace-nowrap"
              >
                <Bot className="h-3 w-3 text-slate-400 shrink-0" />
                {fb}
              </span>
            ))
          ) : (
            <span className="text-sm text-slate-400">—</span>
          )}
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
            <DropdownMenuItem className="gap-2">
              <Eye className="h-4 w-4" />
              Edit model
            </DropdownMenuItem>
            <DropdownMenuItem
              className="gap-2 text-red-600 focus:text-red-600"
              disabled={deleteMutation.isPending}
              onClick={() => deleteMutation.mutate()}
            >
              <Trash2 className="h-4 w-4" />
              Delete model
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </td>
    </tr>
  );
}
