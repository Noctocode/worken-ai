"use client";

import { useState, useRef, useCallback } from "react";
import { GripVertical, MoreVertical } from "lucide-react";
import { SettingsDialog } from "@/components/settings-dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { MODELS } from "@/lib/models";

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

      // Snapshot row positions
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
  const [customName, setCustomName] = useState("Model 1");
  const [modelId, setModelId] = useState("");
  const [fallbacks, setFallbacks] = useState<string[]>([]);
  const [fallbackToAdd, setFallbackToAdd] = useState("");

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

  const availableFallbacks = MODELS.filter(
    (m) => m.id !== modelId && !fallbacks.includes(m.id),
  );

  const getLabelById = (id: string) =>
    MODELS.find((m) => m.id === id)?.label ?? id;

  const handleApply = () => {
    if (!customName.trim() || !modelId) return;
    // TODO: wire up to API
    setCustomName("Model 1");
    setModelId("");
    setFallbacks([]);
    setOpen(false);
  };

  const handleClose = () => {
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
                  <SelectValue placeholder="Select a model" />
                </SelectTrigger>
                <SelectContent className="p-0">
                  {MODELS.map((m) => (
                    <SelectItem key={m.id} value={m.id} className={selectItemClass}>
                      <ModelIcon id={m.id} />
                      {m.label}
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
                onChange={(e) => setCustomName(e.target.value)}
                className={`${inputClass} outline-none focus:border-ring focus:ring-[1px] focus:ring-ring/50`}
              />
            </div>

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
                      {m.label}
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
                                fallbacks.indexOf(id),
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
                        <button
                          type="button"
                          onClick={() => removeFallback(id)}
                          className="cursor-pointer text-success-7 hover:text-success-7/80"
                        >
                          <MoreVertical className="h-4 w-4" />
                        </button>
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