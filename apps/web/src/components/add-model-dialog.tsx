"use client";

import { useState } from "react";
import { MoreVertical } from "lucide-react";
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
              <p className="text-[14px] font-normal leading-[20px] text-text-2 mb-1.5">
                Selected model
              </p>
              <Select value={modelId} onValueChange={setModelId}>
                <SelectTrigger className="w-full h-[50px] rounded-lg border border-border-3 bg-transparent px-[17px] py-[13px] text-[16px] leading-[24px] text-text-1">
                  <SelectValue placeholder="Select a model" />
                </SelectTrigger>
                <SelectContent>
                  {MODELS.map((m) => (
                    <SelectItem key={m.id} value={m.id}>
                      <ModelIcon id={m.id} />
                      {m.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Custom name */}
            <div>
              <p className="text-[14px] font-normal leading-[20px] text-text-2 mb-1.5">
                Custom name
              </p>
              <input
                type="text"
                value={customName}
                onChange={(e) => setCustomName(e.target.value)}
                className="w-full h-[50px] rounded-lg border border-border-3 bg-transparent px-[17px] py-[13px] text-[16px] leading-[24px] text-text-1 outline-none focus:border-ring focus:ring-[1px] focus:ring-ring/50"
              />
            </div>

            {/* Fallback models */}
            <div>
              <p className="text-[16px] font-semibold leading-[24px] text-text-1">
                Fallback models
              </p>
              <p className="text-[14px] font-normal leading-[20px] text-text-2 mt-0.5 mb-3">
                Choose fallback models to use if previous model timeouts (3s) or
                returns error. The fallbacks will be applied in the order you
                specify.
              </p>

              {/* Select fallback model */}
              <p className="text-[14px] font-normal leading-[20px] text-text-2 mb-1.5">
                Select fallback model
              </p>
              <Select
                value={fallbackToAdd}
                onValueChange={(v) => addFallback(v)}
                disabled={availableFallbacks.length === 0}
              >
                <SelectTrigger className="w-full h-[50px] rounded-lg border border-border-3 bg-transparent px-[17px] py-[13px] text-[16px] leading-[24px] text-text-1">
                  <SelectValue placeholder="Search with model custom name" />
                </SelectTrigger>
                <SelectContent>
                  {availableFallbacks.map((m) => (
                    <SelectItem key={m.id} value={m.id}>
                      <ModelIcon id={m.id} />
                      {m.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              {/* Fallback list */}
              {fallbacks.length > 0 && (
                <div className="mt-3 flex flex-col gap-2">
                  {fallbacks.map((id, idx) => (
                    <div
                      key={id}
                      className="flex h-[50px] items-center justify-between rounded bg-[#F2F3F5] px-[17px] py-[13px]"
                    >
                      <div className="flex items-center gap-3">
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
                  ))}
                </div>
              )}
            </div>
          </div>
        </SettingsDialog>
      )}
    </>
  );
}