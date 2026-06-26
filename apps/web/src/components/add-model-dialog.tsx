"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { GripVertical, MoreVertical, Trash2, ArrowUp, ArrowDown, Check, Search } from "lucide-react";
import {
  createModel,
  updateModel,
  type ModelConfig,
} from "@/lib/api";
import { invalidateModelMutations } from "@/lib/hooks/use-user-models";
import { SettingsDialog } from "@/components/settings-dialog";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useAvailableModels } from "@/lib/hooks/use-available-models";
import { ModelCombobox } from "@/components/ui/model-combobox";
import { useLanguage } from "@/lib/i18n";

const MODEL_ICONS: Record<string, { color: string; letter: string }> = {
  "stepfun/step-3.5-flash:free": { color: "#10a37f", letter: "S" },
  "liquid/lfm-2.5-1.2b-thinking:free": { color: "#7c3aed", letter: "L" },
};

function ModelIcon({ id }: { id: string }) {
  const meta = MODEL_ICONS[id] ?? { color: "#94a3b8", letter: "?" };
  return (
    <span
      className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold text-white"
      style={{ backgroundColor: meta.color }}
    >
      {meta.letter}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/*  Pointer-based reorder hook (works inside Radix portals / dialogs) */
/* ------------------------------------------------------------------ */
function usePointerReorder(
  items: string[],
  setItems: React.Dispatch<React.SetStateAction<string[]>>,
) {
  const dragIdx = useRef<number | null>(null);
  const rowRects = useRef<DOMRect[]>([]);
  const listRef = useRef<HTMLDivElement | null>(null);
  const [activeIdx, setActiveIdx] = useState<number | null>(null);
  const [overIdx, setOverIdx] = useState<number | null>(null);

  const onPointerDown = useCallback(
    (e: React.PointerEvent, idx: number) => {
      e.preventDefault();
      (e.target as HTMLElement).setPointerCapture(e.pointerId);

      dragIdx.current = idx;
      setActiveIdx(idx);

      if (listRef.current) {
        const rows = listRef.current.querySelectorAll("[data-fallback-row]");
        rowRects.current = Array.from(rows).map((r) =>
          r.getBoundingClientRect(),
        );
      }
    },
    [],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (dragIdx.current === null) return;

      const y = e.clientY;
      let closest = dragIdx.current;
      let minDist = Infinity;

      for (let i = 0; i < rowRects.current.length; i++) {
        const rect = rowRects.current[i];
        const mid = rect.top + rect.height / 2;
        const dist = Math.abs(y - mid);
        if (dist < minDist) {
          minDist = dist;
          closest = i;
        }
      }

      setOverIdx(closest);
    },
    [],
  );

  const onPointerUp = useCallback(
    () => {
      const from = dragIdx.current;
      const to = overIdx;

      if (from !== null && to !== null && from !== to) {
        setItems((prev) => {
          const next = [...prev];
          const [moved] = next.splice(from, 1);
          next.splice(to, 0, moved);
          return next;
        });
      }

      dragIdx.current = null;
      rowRects.current = [];
      setActiveIdx(null);
      setOverIdx(null);
    },
    [overIdx, setItems],
  );

  return { listRef, activeIdx, overIdx, onPointerDown, onPointerMove, onPointerUp };
}

/* ------------------------------------------------------------------ */

const svgClass = "[&_svg]:text-text-2 [&_svg]:opacity-100 !items-center";

const inputClass =
  "w-full rounded border border-border-3 bg-transparent px-[17px] py-[13px] text-[16px] leading-[24px] text-text-1";

const fallbackSelectClass = `w-full !h-[46px] rounded border border-border-3 bg-transparent px-[17px] py-[11px] text-[16px] leading-[24px] text-text-1 ${svgClass}`;

const selectItemClass =
  "px-[17px] py-[10px] text-[16px] leading-[24px] text-text-1 cursor-pointer";

export function AddModelDialog({
  children,
  existingModel,
  open: openProp,
  onOpenChange,
}: {
  children?: React.ReactNode;
  /** When passed, the dialog runs in edit mode: prefilled from the
   *  model, applies via updateModel, and the title/CTA copy flip. */
  existingModel?: ModelConfig | null;
  /** Controlled-open hooks. When both are provided (typical for the
   *  edit flow opened from ModelRow), parent owns the open state.
   *  When omitted, the dialog falls back to its internal useState +
   *  the `children` trigger span (the Add flow). */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const { t } = useLanguage();
  const isEdit = !!existingModel;
  const [internalOpen, setInternalOpen] = useState(false);
  // Controlled when both props are provided; otherwise fall back to
  // the legacy internal-state pattern with the child trigger span.
  const isControlled = openProp !== undefined && onOpenChange !== undefined;
  const open = isControlled ? openProp : internalOpen;
  const setOpen = (next: boolean) => {
    if (isControlled) onOpenChange!(next);
    else setInternalOpen(next);
  };
  const [customName, setCustomName] = useState("");
  // Tracks whether the user has manually typed into the Custom name
  // field. While false, the field auto-syncs to the picked model's
  // display label so the user doesn't stare at "Model 1" by default.
  // Flips true on the first user edit so a later model swap doesn't
  // clobber their typed-in alias. Edit flow starts touched so the
  // prefilled custom name doesn't get clobbered by the model auto-
  // fill effect.
  const [customNameTouched, setCustomNameTouched] = useState(false);
  const [modelId, setModelId] = useState("");
  const [fallbacks, setFallbacks] = useState<string[]>([]);
  const [fallbackToAdd, setFallbackToAdd] = useState("");
  // Create flow: a searchable multi-select. Each picked model is added as its
  // own alias (auto-named from the catalog label, no fallbacks — fallbacks are
  // configured afterwards via the row's Edit action). Unused in edit mode.
  const [selectedModelIds, setSelectedModelIds] = useState<string[]>([]);
  const [modelSearch, setModelSearch] = useState("");
  const queryClient = useQueryClient();
  const { models, isLoading: modelsLoading, getLabel: getModelLabel } =
    useAvailableModels();

  // Prefill from the existing model on edit open. Re-runs when the
  // dialog opens for a different file so the form always reflects
  // the row the user clicked, not the last edit.
  useEffect(() => {
    if (!open || !existingModel) return;
    setCustomName(existingModel.customName);
    setCustomNameTouched(true);
    setModelId(existingModel.modelIdentifier);
    setFallbacks(existingModel.fallbackModels ?? []);
  }, [open, existingModel]);

  // Auto-fill the alias as soon as a model is picked, unless the
  // user has already typed something themselves. Runs after the
  // models list resolves too — picking a model before models[]
  // hydrates would otherwise fill with the id (fallback in
  // getLabel) until the list arrives.
  useEffect(() => {
    if (!customNameTouched && modelId) {
      setCustomName(getModelLabel(modelId));
    }
  }, [modelId, customNameTouched, getModelLabel]);

  const mutation = useMutation({
    mutationFn: async (
      payload:
        | {
            mode: "edit";
            customName: string;
            modelIdentifier: string;
            fallbackModels: string[];
            integrationId: string | null;
          }
        | { mode: "create"; modelIds: string[] },
    ) => {
      if (payload.mode === "edit") {
        return updateModel(existingModel!.id, {
          customName: payload.customName,
          modelIdentifier: payload.modelIdentifier,
          fallbackModels: payload.fallbackModels,
          integrationId: payload.integrationId,
        });
      }
      // Create: one alias per selected model, auto-named, no fallbacks
      // (set later via Edit). New aliases always route via the default
      // path — Custom LLM endpoints are bound on the Integration tab.
      await Promise.all(
        payload.modelIds.map((id) =>
          createModel({
            customName: getModelLabel(id),
            modelIdentifier: id,
            fallbackModels: [],
            integrationId: null,
          }),
        ),
      );
    },
    onSuccess: () => {
      invalidateModelMutations(queryClient);
      setCustomName("");
      setCustomNameTouched(false);
      setModelId("");
      setFallbacks([]);
      setSelectedModelIds([]);
      setModelSearch("");
      setOpen(false);
    },
  });

  const {
    listRef,
    activeIdx,
    overIdx,
    onPointerDown,
    onPointerMove,
    onPointerUp,
  } = usePointerReorder(fallbacks, setFallbacks);

  const addFallback = (id: string) => {
    if (!id || fallbacks.includes(id) || id === modelId) return;
    setFallbacks((prev) => [...prev, id]);
    setFallbackToAdd("");
  };

  const removeFallback = (id: string) => {
    setFallbacks((prev) => prev.filter((f) => f !== id));
  };

  const moveUp = (idx: number) => {
    if (idx <= 0) return;
    setFallbacks((prev) => {
      const next = [...prev];
      [next[idx - 1], next[idx]] = [next[idx], next[idx - 1]];
      return next;
    });
  };

  const moveDown = (idx: number) => {
    if (idx >= fallbacks.length - 1) return;
    setFallbacks((prev) => {
      const next = [...prev];
      [next[idx], next[idx + 1]] = [next[idx + 1], next[idx]];
      return next;
    });
  };

  const availableFallbacks = models.filter(
    (m) => m.id !== modelId && !fallbacks.includes(m.id),
  );

  // Create-flow search over the catalog (by display name or id).
  const filteredCatalog = models.filter((m) => {
    const q = modelSearch.trim().toLowerCase();
    if (!q) return true;
    return m.name.toLowerCase().includes(q) || m.id.toLowerCase().includes(q);
  });

  const getLabelById = (id: string) => getModelLabel(id);

  const toggleSelectedModel = (id: string) =>
    setSelectedModelIds((prev) =>
      prev.includes(id) ? prev.filter((m) => m !== id) : [...prev, id],
    );

  const handleApply = () => {
    if (isEdit) {
      if (!customName.trim() || !modelId) return;
      mutation.mutate({
        mode: "edit",
        customName: customName.trim(),
        modelIdentifier: modelId,
        fallbackModels: fallbacks,
        // On edit, preserve whatever binding the row already had so editing
        // an integration-created alias here doesn't unbind its endpoint.
        integrationId: existingModel?.integrationId ?? null,
      });
      return;
    }
    if (selectedModelIds.length === 0) return;
    mutation.mutate({ mode: "create", modelIds: selectedModelIds });
  };

  const handleClose = () => {
    // Reset on close so reopening starts clean — otherwise a half-
    // filled previous attempt (e.g. cancelled after typing a custom
    // name) leaks into the next dialog open.
    setCustomName("");
    setCustomNameTouched(false);
    setModelId("");
    setFallbacks([]);
    setSelectedModelIds([]);
    setModelSearch("");
    setOpen(false);
  };

  /** Visual preview of reordered list while dragging */
  const getDisplayOrder = (): string[] => {
    if (activeIdx === null || overIdx === null || activeIdx === overIdx) {
      return fallbacks;
    }
    const next = [...fallbacks];
    const [moved] = next.splice(activeIdx, 1);
    next.splice(overIdx, 0, moved);
    return next;
  };

  const displayFallbacks = getDisplayOrder();

  return (
    <>
      {!isControlled && (
        <span onClick={() => setOpen(true)} className="contents">
          {children}
        </span>
      )}

      {open && (
        <SettingsDialog
          open={open}
          onClose={handleClose}
          onApply={handleApply}
          applyLabel={
            mutation.isPending ? t("addModel.saving") : isEdit ? t("addModel.save") : t("addModel.apply")
          }
          applyPending={mutation.isPending}
          title={isEdit ? t("addModel.editTitle") : t("addModel.addTitle")}
          description={
            isEdit
              ? t("addModel.editDesc")
              : t("addModel.addDesc")
          }
        >
          <div className="space-y-4">
            {/* Selected model — single Select on edit; searchable multi-
                select on create (pick several to add them all at once). */}
            <div>
              <p className="text-[14px] font-normal leading-[20px] text-text-2 mb-2">
                {t("addModel.selectedModel")}
              </p>
              {isEdit ? (
                <ModelCombobox
                  value={modelId}
                  onChange={setModelId}
                  models={models}
                  loading={modelsLoading}
                  placeholder={
                    modelsLoading
                      ? t("addModel.loadingModels")
                      : models.length === 0
                        ? t("addModel.noModels")
                        : t("addModel.selectModel")
                  }
                />
              ) : (
                <div className="space-y-2">
                  <div className="relative">
                    <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-3" />
                    <input
                      type="text"
                      value={modelSearch}
                      onChange={(e) => setModelSearch(e.target.value)}
                      placeholder={t("addModel.searchModels")}
                      className={`${inputClass} !pl-9 outline-none focus:border-ring focus:ring-[1px] focus:ring-ring/50`}
                    />
                  </div>
                  <div className="max-h-[260px] divide-y divide-border-2 overflow-y-auto rounded border border-border-3">
                    {modelsLoading ? (
                      <p className="px-3 py-6 text-center text-[14px] text-text-3">
                        {t("addModel.loadingModels")}
                      </p>
                    ) : filteredCatalog.length === 0 ? (
                      <p className="px-3 py-6 text-center text-[14px] text-text-3">
                        {models.length === 0
                          ? t("addModel.noModels")
                          : t("addModel.noMatch")}
                      </p>
                    ) : (
                      filteredCatalog.map((m) => {
                        const checked = selectedModelIds.includes(m.id);
                        return (
                          <button
                            key={m.id}
                            type="button"
                            onClick={() => toggleSelectedModel(m.id)}
                            className={`flex w-full items-center gap-2 px-3 py-2 text-left text-[15px] transition-colors ${
                              checked
                                ? "bg-primary-1 text-text-1"
                                : "text-text-1 hover:bg-bg-1"
                            }`}
                          >
                            <ModelIcon id={m.id} />
                            <span className="flex-1 truncate">{m.name}</span>
                            {checked && (
                              <Check className="h-4 w-4 shrink-0 text-primary-6" />
                            )}
                          </button>
                        );
                      })
                    )}
                  </div>
                  {selectedModelIds.length > 0 && (
                    <p className="text-[12px] text-text-3">
                      {selectedModelIds.length} {t("addModel.selectedCount")}
                    </p>
                  )}
                </div>
              )}
            </div>

            {/* Custom name + fallbacks — edit only. On create each picked
                model is auto-named and gets no fallbacks; both are tuned
                afterwards via the row's Edit action. */}
            {isEdit && (
            <>
            <div>
              <p className="text-[14px] font-normal leading-[20px] text-text-2 mb-2">
                {t("addModel.customName")}
              </p>
              <input
                type="text"
                value={customName}
                onChange={(e) => {
                  setCustomName(e.target.value);
                  setCustomNameTouched(true);
                }}
                placeholder={t("addModel.pickAutofill")}
                className={`${inputClass} outline-none focus:border-ring focus:ring-[1px] focus:ring-ring/50`}
              />
            </div>

            {/* Fallback models */}
            <div>
              <p className="text-[16px] font-semibold leading-[24px] text-text-1 mb-2">
                {t("addModel.fallbackModels")}
              </p>
              <p className="text-[14px] font-normal leading-[20px] text-text-2 mt-0.5 mb-4">
                {t("addModel.fallbackHint")}
              </p>

              {/* Select fallback model */}
              <p className="text-[14px] font-normal leading-[20px] text-text-2 mb-2">
                {t("addModel.selectFallback")}
              </p>
              <Select
                value={fallbackToAdd}
                onValueChange={(v) => addFallback(v)}
                disabled={availableFallbacks.length === 0}
              >
                <SelectTrigger className={fallbackSelectClass}>
                  <SelectValue placeholder={t("addModel.searchByName")} />
                </SelectTrigger>
                <SelectContent className="p-0">
                  {availableFallbacks.map((m) => (
                    <SelectItem key={m.id} value={m.id} className={selectItemClass}>
                      <ModelIcon id={m.id} />
                      {m.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              {/* Fallback list — pointer-based reorder */}
              {fallbacks.length > 0 && (
                <div
                  ref={listRef}
                  className="mt-3 flex flex-col gap-3 select-none"
                  onPointerMove={onPointerMove}
                  onPointerUp={onPointerUp}
                >
                  {displayFallbacks.map((id, idx) => {
                    const realIdx = fallbacks.indexOf(id);
                    const isDragging =
                      activeIdx !== null && fallbacks[activeIdx] === id;

                    return (
                      <div
                        key={id}
                        data-fallback-row
                        className={`flex items-center justify-between rounded bg-[#F2F3F5] px-[17px] py-[10px] transition-shadow ${
                          isDragging
                            ? "shadow-md ring-2 ring-primary-6/30"
                            : ""
                        }`}
                      >
                        <div className="flex items-center gap-3">
                          <GripVertical
                            className="h-4 w-4 shrink-0 cursor-grab text-text-2 touch-none active:cursor-grabbing"
                            onPointerDown={(e) =>
                              onPointerDown(
                                e as unknown as React.PointerEvent,
                                realIdx,
                              )
                            }
                          />
                          <span className="text-[16px] font-normal leading-[24px] text-text-1">
                            {idx + 1}
                          </span>
                          <ModelIcon id={id} />
                          <span className="text-[16px] font-normal leading-[24px] text-text-1">
                            {getLabelById(id)}
                          </span>
                        </div>

                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7 cursor-pointer text-success-7 hover:text-success-7/80"
                            >
                              <MoreVertical className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem
                              className="gap-2"
                              onClick={() => removeFallback(id)}
                            >
                              <Trash2 className="h-4 w-4" />
                              {t("addModel.remove")}
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              className="gap-2"
                              disabled={realIdx <= 0}
                              onClick={() => moveUp(realIdx)}
                            >
                              <ArrowUp className="h-4 w-4" />
                              {t("addModel.moveUp")}
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              className="gap-2"
                              disabled={realIdx >= fallbacks.length - 1}
                              onClick={() => moveDown(realIdx)}
                            >
                              <ArrowDown className="h-4 w-4" />
                              {t("addModel.moveDown")}
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
            </>
            )}
          </div>
        </SettingsDialog>
      )}
    </>
  );
}