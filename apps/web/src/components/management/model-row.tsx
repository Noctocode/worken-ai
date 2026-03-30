"use client";

import { useState } from "react";
import { MoreVertical, Eye, Bot } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Switch } from "@/components/ui/switch";
import { MODELS } from "@/lib/models";

export function ModelRow({ model }: { model: (typeof MODELS)[number] }) {
  const [active, setActive] = useState(true);
  const fallbacks = MODELS.filter((m) => m.id !== model.id);

  return (
    <tr className="h-14 border-b border-bg-1 transition-colors hover:bg-slate-50/50">
      {/* Custom Name */}
      <td className="px-4 align-middle text-base font-normal text-black">
        {model.label}
      </td>
      {/* Status */}
      <td className="px-4 align-middle">
        <div className="flex items-center gap-2 min-w-[100px]">
          <Switch checked={active} onCheckedChange={setActive} />
          <span className="text-sm text-black-700">{active ? "Active" : "Inactive"}</span>
        </div>
      </td>
      {/* Model */}
      <td className="px-4 align-middle">
        <div className="flex items-center gap-1.5">
          <Bot className="h-4 w-4 text-slate-400" />
          <span className="text-base font-normal text-black">{model.label}</span>
        </div>
      </td>
      {/* Fallback models */}
      <td className="px-4 align-middle">
        <div className="flex items-center gap-1.5 flex-wrap">
          {fallbacks.map((fb) => (
            <span
              key={fb.id}
              className="flex items-center gap-1 rounded-full border border-slate-200 bg-slate-50 px-2.5 py-0.5 text-[12px] text-slate-700"
            >
              <Bot className="h-3 w-3 text-slate-400" />
              {fb.label}
            </span>
          ))}
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
          </DropdownMenuContent>
        </DropdownMenu>
      </td>
    </tr>
  );
}
