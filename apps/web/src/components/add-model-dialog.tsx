"use client";

import { useState } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { MODELS } from "@/lib/models";

export function AddModelDialog({
  children,
}: {
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [customName, setCustomName] = useState("");
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

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!customName.trim() || !modelId) return;
    // TODO: wire up to API
    setCustomName("");
    setModelId("");
    setFallbacks([]);
    setOpen(false);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add New Model</DialogTitle>
          <DialogDescription>
            Configure a model to make it available across your workspace.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="model-custom-name">Custom Name</Label>
            <Input
              id="model-custom-name"
              placeholder="e.g. My GPT-4 Model"
              value={customName}
              onChange={(e) => setCustomName(e.target.value)}
              required
            />
          </div>

          <div className="space-y-2">
            <Label>Model</Label>
            <Select value={modelId} onValueChange={setModelId}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Select a model" />
              </SelectTrigger>
              <SelectContent>
                {MODELS.map((m) => (
                  <SelectItem key={m.id} value={m.id}>
                    {m.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>Fallback Models</Label>
            {fallbacks.length > 0 && (
              <div className="flex flex-wrap gap-2 mb-2">
                {fallbacks.map((id) => (
                  <span
                    key={id}
                    className="flex items-center gap-1 rounded-full border border-slate-200 bg-slate-50 px-2.5 py-0.5 text-[12px] text-slate-700"
                  >
                    {getLabelById(id)}
                    <button
                      type="button"
                      onClick={() => removeFallback(id)}
                      className="ml-0.5 text-slate-400 hover:text-slate-600"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </span>
                ))}
              </div>
            )}
            <Select
              value={fallbackToAdd}
              onValueChange={(v) => addFallback(v)}
              disabled={availableFallbacks.length === 0}
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Add fallback model…" />
              </SelectTrigger>
              <SelectContent>
                {availableFallbacks.map((m) => (
                  <SelectItem key={m.id} value={m.id}>
                    {m.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <DialogFooter>
            <Button type="submit" disabled={!customName.trim() || !modelId}>
              Add Model
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}