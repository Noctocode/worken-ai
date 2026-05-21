"use client";

import { useState } from "react";
import {
  MoreVertical,
  Pencil,
  Trash2,
  Bot,
  KeySquare,
  Globe,
  Loader2,
} from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { AddModelDialog } from "@/components/add-model-dialog";

function providerOf(modelId: string): string | null {
  const idx = modelId.indexOf("/");
  return idx === -1 ? null : modelId.slice(0, idx);
}

/**
 * Mobile-only card variant of `ModelRow`. The 5-column table layout
 * (Custom Name | Status | Model | Fallbacks | Actions) compresses
 * poorly at 375px wide once the model identifier + BYOK/Custom badge
 * + fallback chips show up. Rendered at `<lg`; desktop keeps the
 * existing table.
 */
export function ModelCard({ model }: { model: ModelConfig }) {
  const queryClient = useQueryClient();
  const [editOpen, setEditOpen] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);

  // refetchType: 'all' on both mutations so the
  // ["models", "effective"] cache that drives /compare-models and the
  // project picker stays in sync even when those views are unmounted.
  const toggleMutation = useMutation({
    mutationFn: () => updateModel(model.id, { isActive: !model.isActive }),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ["models"],
        refetchType: "all",
      });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () => deleteModel(model.id),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ["models"],
        refetchType: "all",
      });
      setDeleteConfirmOpen(false);
      toast.success(`Deleted "${model.customName}".`);
    },
    onError: (err: Error) =>
      toast.error(err.message || "Failed to delete model."),
  });

  const fallbacks = (model.fallbackModels ?? []) as string[];

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
    <div className="flex flex-col gap-2.5 rounded-xl border border-border-2 bg-bg-white p-3.5">
      {/* Row 1: Custom Name + kebab */}
      <div className="flex items-start justify-between gap-3">
        <span className="min-w-0 flex-1 truncate text-[15px] font-semibold text-text-1">
          {model.customName}
        </span>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              aria-label={`Actions for ${model.customName}`}
              className="h-8 w-8 shrink-0 rounded-lg border border-border-2 text-text-2 hover:bg-bg-1 hover:text-text-1"
            >
              <MoreVertical className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem
              className="gap-2"
              onClick={() => setEditOpen(true)}
            >
              <Pencil className="h-4 w-4" />
              Edit model
            </DropdownMenuItem>
            <DropdownMenuItem
              className="gap-2 text-danger-6 focus:text-danger-6"
              onClick={() => setDeleteConfirmOpen(true)}
            >
              <Trash2 className="h-4 w-4" />
              Delete model
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Status switch */}
      <div className="flex items-center justify-between">
        <span className="text-[12px] text-text-3">Status</span>
        <div className="flex items-center gap-2">
          <Switch
            checked={model.isActive}
            onCheckedChange={() => toggleMutation.mutate()}
            disabled={toggleMutation.isPending}
          />
          <span className="text-[13px] font-medium text-text-1">
            {model.isActive ? "Active" : "Inactive"}
          </span>
        </div>
      </div>

      <div className="h-px bg-border-2" />

      {/* Model identifier + routing badge */}
      <div className="flex flex-col gap-1.5">
        <span className="text-[12px] text-text-3">Model</span>
        <div className="flex flex-wrap items-center gap-1.5">
          <Bot className="h-4 w-4 shrink-0 text-text-3" />
          <span className="break-all text-[13px] text-text-1">
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
      </div>

      {/* Fallback models */}
      <div className="flex flex-col gap-1.5">
        <span className="text-[12px] text-text-3">Fallback models</span>
        {fallbacks.length > 0 ? (
          <div className="flex flex-wrap items-center gap-1.5">
            {fallbacks.map((fb) => (
              <span
                key={fb}
                className="inline-flex items-center gap-1 rounded-full border border-border-2 bg-bg-1 px-2 py-0.5 text-[12px] text-text-1"
              >
                <Bot className="h-3 w-3 shrink-0 text-text-3" />
                <span className="break-all">{fb}</span>
              </span>
            ))}
          </div>
        ) : (
          <span className="text-[13px] text-text-3">—</span>
        )}
      </div>

      {/* Controlled edit dialog (existing-model mode shares the same
          AddModelDialog as creation, so alias / fallback / integration
          editing stays a single source of truth). */}
      <AddModelDialog
        existingModel={model}
        open={editOpen}
        onOpenChange={setEditOpen}
      />

      <Dialog
        open={deleteConfirmOpen}
        onOpenChange={(open) =>
          !deleteMutation.isPending && setDeleteConfirmOpen(open)
        }
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete model</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete{" "}
              <strong>{model.customName}</strong>? This action cannot be undone.
              Projects routed to this alias will fall back to the WorkenAI
              default.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              onClick={() => setDeleteConfirmOpen(false)}
              disabled={deleteMutation.isPending}
              className="cursor-pointer"
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => deleteMutation.mutate()}
              disabled={deleteMutation.isPending}
              className="cursor-pointer"
            >
              {deleteMutation.isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Deleting…
                </>
              ) : (
                "Delete"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
