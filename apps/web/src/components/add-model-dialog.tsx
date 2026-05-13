"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { GripVertical, MoreVertical, Trash2, ArrowUp, ArrowDown } from "lucide-react";
import { createModel, fetchIntegrations } from "@/lib/api";
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

const MODEL_ICONS: Record<string, { color: string; letter: string }> = {
  "stepfun/step-3.5-flash:free": { color: "#10a37f", letter: "S" },
  "arcee-ai/trinity-large-preview:free": { color: "#1a73e8", letter: "T" },
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

const modelSelectClass = `${inputClass} !h-auto ${svgClass}`;

const fallbackSelectClass = `w-full !h-[46px] rounded border border-border-3 bg-transparent px-[17px] py-[11px] text-[16px] leading-[24px] text-text-1 ${svgClass}`;

const selectItemClass =
  "px-[17px] py-[10px] text-[16px] leading-[24px] text-text-1 cursor-pointer";

export function AddModelDialog({
  children,
}: {
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [customName, setCustomName] = useState("");
  // Tracks whether the user has manually typed into the Custom name
  // field. While false, the field auto-syncs to the picked model's
  // display label so the user doesn't stare at "Model 1" by default.
  // Flips true on the first user edit so a later model swap doesn't
  // clobber their typed-in alias.
  const [customNameTouched, setCustomNameTouched] = useState(false);
  const [modelId, setModelId] = useState("");
  const [fallbacks, setFallbacks] = useState<string[]>([]);
  const [fallbackToAdd, setFallbackToAdd] = useState("");
  const [integrationId, setIntegrationId] = useState<string>("");
  const queryClient = useQueryClient();
  const { models, isLoading: modelsLoading, getLabel: getModelLabel } =
    useAvailableModels();

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

  // Custom LLMs the user has registered in Management → Integration.
  // Listed as an optional binding so an alias can route to a self-hosted
  // or BYOK endpoint instead of OpenRouter.
  const { data: integrations } = useQuery({
    queryKey: ["integrations"],
    queryFn: fetchIntegrations,
    enabled: open,
  });
  const customIntegrations =
    integrations?.filter((i) => i.isCustom && i.isEnabled) ?? [];

  const mutation = useMutation({
    mutationFn: createModel,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["models"] });
      setCustomName("");
      setCustomNameTouched(false);
      setModelId("");
      setFallbacks([]);
      setIntegrationId("");
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

  const getLabelById = (id: string) => getModelLabel(id);

  const handleApply = () => {
    if (!customName.trim() || !modelId) return;
    mutation.mutate({
      customName: customName.trim(),
      modelIdentifier: modelId,
      fallbackModels: fallbacks,
      integrationId: integrationId || null,
    });
  };

  const handleClose = () => {
    // Reset on close so reopening starts clean — otherwise a half-
    // filled previous attempt (e.g. cancelled after typing a custom
    // name) leaks into the next dialog open.
    setCustomName("");
    setCustomNameTouched(false);
    setModelId("");
    setFallbacks([]);
    setIntegrationId("");
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
      <span onClick={() => setOpen(true)} className="contents">
        {children}
      </span>

      {open && (
        <SettingsDialog
          open={open}
          onClose={handleClose}
          onApply={handleApply}
          applyLabel={mutation.isPending ? "Saving…" : "Apply"}
          applyPending={mutation.isPending}
          title="Add model"
          description="Configure a model to make it available across your workspace."
        >
          <div className="space-y-4">
            {/* Selected model */}
            <div>
              <p className="text-[14px] font-normal leading-[20px] text-text-2 mb-2">
                Selected model
              </p>
              <Select value={modelId} onValueChange={setModelId}>
                <SelectTrigger className={modelSelectClass}>
                  <SelectValue
                    placeholder={
                      modelsLoading
                        ? "Loading models…"
                        : models.length === 0
                          ? "No models enabled — ask an admin"
                          : "Select a model"
                    }
                  />
                </SelectTrigger>
                <SelectContent className="p-0">
                  {models.map((m) => (
                    <SelectItem key={m.id} value={m.id} className={selectItemClass}>
                      <ModelIcon id={m.id} />
                      {m.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Custom name */}
            <div>
              <p className="text-[14px] font-normal leading-[20px] text-text-2 mb-2">
                Custom name
              </p>
              <input
                type="text"
                value={customName}
                onChange={(e) => {
                  setCustomName(e.target.value);
                  setCustomNameTouched(true);
                }}
                placeholder="Pick a model to autofill"
                className={`${inputClass} outline-none focus:border-ring focus:ring-[1px] focus:ring-ring/50`}
              />
            </div>

            {/* Optional: bind to a Custom LLM endpoint registered in
                Management → Integration. Hidden when the user has none —
                it's an opt-in advanced setting that only matters for
                self-hosted / BYOK endpoints. */}
            {customIntegrations.length > 0 && (
              <div>
                <p className="text-[14px] font-normal leading-[20px] text-text-2 mb-2">
                  Custom LLM endpoint{" "}
                  <span className="text-text-3">(optional)</span>
                </p>
                <Select
                  value={integrationId || "__none__"}
                  onValueChange={(v) =>
                    setIntegrationId(v === "__none__" ? "" : v)
                  }
                >
                  <SelectTrigger className={modelSelectClass}>
                    <SelectValue placeholder="WorkenAI default" />
                  </SelectTrigger>
                  <SelectContent className="p-0">
                    <SelectItem value="__none__" className={selectItemClass}>
                      WorkenAI default
                    </SelectItem>
                    {customIntegrations.map((i) => (
                      <SelectItem
                        key={i.id ?? i.providerId}
                        value={i.id ?? ""}
                        className={selectItemClass}
                      >
                        {i.displayName}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="mt-1 text-[12px] text-text-3">
                  When set, chat calls for this alias route to the selected
                  Custom LLM endpoint instead of the WorkenAI default.
                </p>
              </div>
            )}

            {/* Fallback models */}
            <div>
              <p className="text-[16px] font-semibold leading-[24px] text-text-1 mb-2">
                Fallback models
              </p>
              <p className="text-[14px] font-normal leading-[20px] text-text-2 mt-0.5 mb-4">
                Choose fallback models to use if previous model timeouts (3s) or
                returns error. The fallbacks will be applied in the order you
                specify.
              </p>

              {/* Select fallback model */}
              <p className="text-[14px] font-normal leading-[20px] text-text-2 mb-2">
                Select fallback model
              </p>
              <Select
                value={fallbackToAdd}
                onValueChange={(v) => addFallback(v)}
                disabled={availableFallbacks.length === 0}
              >
                <SelectTrigger className={fallbackSelectClass}>
                  <SelectValue placeholder="Search with model custom name" />
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
                              Remove
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              className="gap-2"
                              disabled={realIdx <= 0}
                              onClick={() => moveUp(realIdx)}
                            >
                              <ArrowUp className="h-4 w-4" />
                              Move up
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              className="gap-2"
                              disabled={realIdx >= fallbacks.length - 1}
                              onClick={() => moveDown(realIdx)}
                            >
                              <ArrowDown className="h-4 w-4" />
                              Move down
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </SettingsDialog>
      )}
    </>
  );
}