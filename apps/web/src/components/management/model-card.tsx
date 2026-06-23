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
import { Checkbox } from "@/components/ui/checkbox";
import {
  deleteModel,
  fetchIntegrations,
  updateModel,
  type ModelConfig,
} from "@/lib/api";
import { invalidateModelMutations } from "@/lib/hooks/use-user-models";
import { AddModelDialog } from "@/components/add-model-dialog";
import { useAuth } from "@/components/providers";
import { useLanguage } from "@/lib/i18n";

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
export function ModelCard({
  model,
  selectable = false,
  selected = false,
  onToggleSelected,
}: {
  model: ModelConfig;
  // Bulk-select is admin-only; the parent gates `selectable`.
  selectable?: boolean;
  selected?: boolean;
  onToggleSelected?: () => void;
}) {
  const { t } = useLanguage();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const [editOpen, setEditOpen] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);

  const toggleMutation = useMutation({
    mutationFn: () => updateModel(model.id, { isActive: !model.isActive }),
    onSuccess: () => invalidateModelMutations(queryClient),
  });

  const deleteMutation = useMutation({
    mutationFn: () => deleteModel(model.id),
    onSuccess: () => {
      invalidateModelMutations(queryClient);
      setDeleteConfirmOpen(false);
      toast.success(`${t("mgmt.rows.deletedToast")} "${model.customName}".`);
    },
    onError: (err: Error) =>
      toast.error(err.message || t("mgmt.rows.deleteFailed")),
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
    <div
      className={`flex flex-col gap-2.5 rounded-xl border p-3.5 ${
        selectable && selected
          ? "border-primary-3 bg-primary-1/30"
          : "border-border-2 bg-bg-white"
      }`}
    >
      {/* Row 1: Custom Name + kebab */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-1 items-center gap-2.5">
          {selectable && (
            <Checkbox
              aria-label={`${t("mgmt.rows.actionsFor")} ${model.customName}`}
              checked={selected}
              onCheckedChange={() => onToggleSelected?.()}
              className="shrink-0"
            />
          )}
          <span className="min-w-0 flex-1 truncate text-[15px] font-semibold text-text-1">
            {model.customName}
          </span>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              aria-label={`${t("mgmt.rows.actionsFor")} ${model.customName}`}
              className="h-8 w-8 shrink-0 rounded-lg border border-border-2 text-text-2 hover:bg-bg-1 hover:text-text-1"
            >
              <MoreVertical className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem
              className="gap-2"
              onClick={() => setEditOpen(true)}
              disabled={!isAdmin}
              title={isAdmin ? undefined : t("mgmt.rows.editModelsAdmin")}
            >
              <Pencil className="h-4 w-4" />
              {t("mgmt.rows.editModel")}
            </DropdownMenuItem>
            <DropdownMenuItem
              className="gap-2 text-danger-6 focus:text-danger-6"
              onClick={() => setDeleteConfirmOpen(true)}
              disabled={!isAdmin}
              title={isAdmin ? undefined : t("mgmt.rows.deleteModelsAdmin")}
            >
              <Trash2 className="h-4 w-4" />
              {t("mgmt.rows.removeModel")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Status switch */}
      <div className="flex items-center justify-between">
        <span className="text-[12px] text-text-3">{t("mgmt.rows.statusLabel")}</span>
        <div className="flex items-center gap-2">
          <Switch
            checked={model.isActive}
            onCheckedChange={() => toggleMutation.mutate()}
            disabled={toggleMutation.isPending || !isAdmin}
            title={isAdmin ? undefined : t("mgmt.rows.changeModelsAdmin")}
            className={!isAdmin ? "opacity-50 cursor-not-allowed" : ""}
          />
          <span className="text-[13px] font-medium text-text-1">
            {model.isActive ? t("mgmt.rows.active") : t("mgmt.rows.inactive")}
          </span>
        </div>
      </div>

      <div className="h-px bg-border-2" />

      {/* Model identifier + routing badge */}
      <div className="flex flex-col gap-1.5">
        <span className="text-[12px] text-text-3">{t("mgmt.rows.modelLabel")}</span>
        <div className="flex flex-wrap items-center gap-1.5">
          <Bot className="h-4 w-4 shrink-0 text-text-3" />
          <span className="break-all text-[13px] text-text-1">
            {model.upstreamModel ?? model.modelIdentifier}
          </span>
          {customIntegration && (
            <span
              className="inline-flex items-center gap-1 rounded-full bg-primary-1 px-2 py-0.5 text-[11px] font-medium text-primary-7"
              title={`${t("mgmt.rows.routesCustom")} ${customIntegration.apiUrl ?? "—"}`}
            >
              <Globe className="h-3 w-3" />
              {t("mgmt.rows.custom")}
            </span>
          )}
          {byokIntegration && (
            <span
              className="inline-flex items-center gap-1 rounded-full bg-success-1 px-2 py-0.5 text-[11px] font-medium text-success-7"
              title={`${t("mgmt.rows.routesBYOK")} ${byokIntegration.displayName} ${t("mgmt.rows.routesBYOKSuffix")}`}
            >
              <KeySquare className="h-3 w-3" />
              {t("mgmt.rows.byok")}
            </span>
          )}
        </div>
      </div>

      {/* Fallback models */}
      <div className="flex flex-col gap-1.5">
        <span className="text-[12px] text-text-3">{t("mgmt.rows.fallbackModels")}</span>
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
            <DialogTitle>{t("mgmt.rows.deleteModelTitle")}</DialogTitle>
            <DialogDescription>
              {t("mgmt.rows.deleteModelDesc1")}{" "}
              <strong>{model.customName}</strong>{t("mgmt.rows.deleteModelDesc2")}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              onClick={() => setDeleteConfirmOpen(false)}
              disabled={deleteMutation.isPending}
              className="cursor-pointer"
            >
              {t("mgmt.rows.cancel")}
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
                  {t("mgmt.rows.deleting")}
                </>
              ) : (
                t("mgmt.rows.deleteBtn")
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
