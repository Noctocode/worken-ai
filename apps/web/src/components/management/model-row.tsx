"use client";

import { MoreVertical, Eye, Trash2, Bot, KeySquare, Globe } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Switch } from "@/components/ui/switch";
import {
  deleteModel,
  fetchIntegrations,
  updateModel,
  type ModelConfig,
} from "@/lib/api";

function providerOf(modelId: string): string | null {
  const idx = modelId.indexOf("/");
  return idx === -1 ? null : modelId.slice(0, idx);
}

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

  // Routing inference: if the alias is bound to a Custom LLM, show "Custom".
  // If not but the user has a BYOK key for the model's provider, show "BYOK".
  // The badge is a read-only hint; the actual routing happens BE-side in
  // ChatTransportService.
  const { data: integrations } = useQuery({
    queryKey: ["integrations"],
    queryFn: fetchIntegrations,
    staleTime: 60 * 1000,
  });

  const customIntegration = model.integrationId
    ? integrations?.find((i) => i.id === model.integrationId)
    : null;

  const provider = providerOf(model.modelIdentifier);
  const byokIntegration =
    !customIntegration && provider
      ? integrations?.find(
          (i) => i.providerId === provider && i.hasApiKey && i.isEnabled,
        )
      : null;

  return (
    <tr className="h-14 border-b border-bg-1 transition-colors hover:bg-bg-1/50">
      {/* Custom Name */}
      <td className="px-4 align-middle text-base font-normal text-text-1 whitespace-nowrap">
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
          <Bot className="h-4 w-4 text-text-3 shrink-0" />
          <span className="text-base font-normal text-text-1">
            {model.modelIdentifier}
          </span>
          {customIntegration && (
            <span
              className="inline-flex items-center gap-1 rounded-full bg-primary-1 px-2 py-0.5 text-[11px] font-medium text-primary-7"
              title={`Routes to Custom LLM at ${customIntegration.apiUrl ?? "—"}`}
            >
              <Globe className="h-3 w-3" />
              Custom
            </span>
          )}
          {byokIntegration && (
            <span
              className="inline-flex items-center gap-1 rounded-full bg-success-1 px-2 py-0.5 text-[11px] font-medium text-success-7"
              title={`Routes through your ${byokIntegration.displayName} key (BYOK)`}
            >
              <KeySquare className="h-3 w-3" />
              BYOK
            </span>
          )}
        </div>
      </td>
      {/* Fallback models */}
      <td className="px-4 align-middle">
        <div className="flex items-center gap-1.5 flex-wrap">
          {fallbacks.length > 0 ? (
            fallbacks.map((fb) => (
              <span
                key={fb}
                className="flex items-center gap-1 rounded-full border border-border-2 bg-bg-1 px-2.5 py-0.5 text-[12px] text-text-1 whitespace-nowrap"
              >
                <Bot className="h-3 w-3 text-text-3 shrink-0" />
                {fb}
              </span>
            ))
          ) : (
            <span className="text-sm text-text-3">—</span>
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
              className="h-7 w-7 text-text-3 hover:text-text-1"
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
              className="gap-2 text-danger-6 focus:text-danger-6"
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
