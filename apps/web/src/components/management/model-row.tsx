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

export function ModelRow({ model }: { model: ModelConfig }) {
  const queryClient = useQueryClient();

  // Edit + delete-confirm dialogs are owned per row so opening one
  // row's editor doesn't bleed into another. Both stay closed by
  // default; the dropdown items flip them open.
  const [editOpen, setEditOpen] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);

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
      setDeleteConfirmOpen(false);
      toast.success(`Deleted "${model.customName}".`);
    },
    onError: (err: Error) =>
      toast.error(err.message || "Failed to delete model."),
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

        {/* Edit dialog shares the AddModelDialog component in
            controlled / existing-model mode so the alias, fallback
            order, and integration binding stay in one source of
            truth. */}
        <AddModelDialog
          existingModel={model}
          open={editOpen}
          onOpenChange={setEditOpen}
        />

        {/* Delete confirmation — destructive and irreversible, so a
            full dialog (not an inline toggle) makes the consequences
            harder to skip. Matches the KC delete-file pattern. */}
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
                <strong>{model.customName}</strong>? This action cannot be
                undone. Projects routed to this alias will fall back to the
                WorkenAI default.
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
      </td>
    </tr>
  );
}
