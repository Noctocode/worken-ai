"use client";

import * as React from "react";
import { Check, ChevronsUpDown, Search } from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import { useLanguage } from "@/lib/i18n";

export interface ModelOption {
  id: string;
  name: string;
}

/**
 * Searchable model picker. One reusable combobox so every "Select model"
 * surface (new project, change model, AI Cron, Add model, …) sources the
 * same dynamic list and gets a search box — no more hardcoded model lists or
 * scroll-only dropdowns.
 *
 * Pass `trigger` to render a custom trigger (e.g. the appbar's header chip);
 * otherwise a default bordered button shows the selected model name.
 */
export function ModelCombobox({
  value,
  onChange,
  models,
  placeholder,
  disabled,
  loading,
  align = "start",
  className,
  contentClassName,
  trigger,
}: {
  value?: string;
  onChange: (id: string) => void;
  models: ModelOption[];
  placeholder?: string;
  disabled?: boolean;
  loading?: boolean;
  align?: "start" | "center" | "end";
  className?: string;
  contentClassName?: string;
  trigger?: React.ReactNode;
}) {
  const { t } = useLanguage();
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState("");

  const selected = models.find((m) => m.id === value);
  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return models;
    return models.filter(
      (m) =>
        m.name.toLowerCase().includes(q) || m.id.toLowerCase().includes(q),
    );
  }, [models, query]);

  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) setQuery("");
      }}
    >
      <PopoverTrigger asChild>
        {trigger ?? (
          <button
            type="button"
            disabled={disabled}
            className={`flex h-10 w-full items-center justify-between gap-2 rounded-md border border-border-3 bg-bg-white px-3 text-[14px] text-text-1 outline-none focus:border-primary-6 disabled:cursor-not-allowed disabled:opacity-60 ${className ?? ""}`}
          >
            <span className={`truncate ${selected ? "" : "text-text-3"}`}>
              {selected
                ? selected.name
                : (placeholder ?? t("modelSelect.placeholder"))}
            </span>
            <ChevronsUpDown className="h-4 w-4 shrink-0 text-text-3" />
          </button>
        )}
      </PopoverTrigger>
      <PopoverContent
        align={align}
        className={`w-[var(--radix-popover-trigger-width)] min-w-[240px] p-0 ${contentClassName ?? ""}`}
      >
        <div className="relative border-b border-border-2 p-2">
          <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-text-3" />
          <Input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("modelSelect.search")}
            className="h-9 pl-9"
          />
        </div>
        <div className="max-h-[280px] overflow-y-auto p-1">
          {loading ? (
            <p className="px-3 py-6 text-center text-[13px] text-text-3">
              {t("modelSelect.loading")}
            </p>
          ) : filtered.length === 0 ? (
            <p className="px-3 py-6 text-center text-[13px] text-text-3">
              {t("modelSelect.noMatch")}
            </p>
          ) : (
            filtered.map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() => {
                  onChange(m.id);
                  setOpen(false);
                  setQuery("");
                }}
                className="flex w-full cursor-pointer items-center justify-between gap-2 rounded px-2 py-1.5 text-left text-[13px] text-text-1 hover:bg-bg-1"
              >
                <span className="truncate">{m.name}</span>
                {m.id === value ? (
                  <Check className="h-3.5 w-3.5 shrink-0 text-primary-6" />
                ) : null}
              </button>
            ))
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
