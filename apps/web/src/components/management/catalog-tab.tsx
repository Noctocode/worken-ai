"use client";

import { useMemo, useState } from "react";
import { Loader2, Search } from "lucide-react";
import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import {
  fetchModelsCatalog,
  setModelEnabled,
  type CatalogModel,
} from "@/lib/api";
import { Switch } from "@/components/ui/switch";

function getProvider(modelId: string): string {
  const idx = modelId.indexOf("/");
  return idx === -1 ? "unknown" : modelId.slice(0, idx);
}

function formatPricePerMillion(raw: string | undefined): string {
  if (!raw) return "—";
  const n = Number(raw);
  if (!Number.isFinite(n)) return "—";
  const perMillion = n * 1_000_000;
  return `$${perMillion.toFixed(2)}/M`;
}

export function CatalogTab() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [provider, setProvider] = useState<string>("all");

  const {
    data: catalog,
    isLoading,
    error,
  } = useQuery({
    queryKey: ["models", "catalog"],
    queryFn: fetchModelsCatalog,
    staleTime: 5 * 60 * 1000,
  });

  const toggleMutation = useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) =>
      setModelEnabled(id, enabled),
    onSuccess: () => {
      // Refresh both: catalog (admin) and available (end-user) caches.
      queryClient.invalidateQueries({ queryKey: ["models", "catalog"] });
      queryClient.invalidateQueries({ queryKey: ["models", "available"] });
    },
  });

  const providers = useMemo(() => {
    if (!catalog) return [];
    const set = new Set(catalog.map((m) => getProvider(m.id)));
    return Array.from(set).sort();
  }, [catalog]);

  const filtered = useMemo(() => {
    if (!catalog) return [];
    const q = search.trim().toLowerCase();
    return catalog.filter((m) => {
      if (provider !== "all" && getProvider(m.id) !== provider) return false;
      if (!q) return true;
      return (
        m.id.toLowerCase().includes(q) ||
        m.name.toLowerCase().includes(q) ||
        (m.description?.toLowerCase().includes(q) ?? false)
      );
    });
  }, [catalog, search, provider]);

  const enabledCount = catalog?.filter((m) => m.enabled).length ?? 0;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-6 w-6 animate-spin text-text-3" />
      </div>
    );
  }
  if (error) {
    return (
      <div className="py-16 text-center text-sm text-danger-6">
        Failed to load OpenRouter catalog. Make sure you&apos;re an admin and
        the API is reachable.
      </div>
    );
  }
  if (!catalog || catalog.length === 0) {
    return (
      <div className="py-16 text-center text-sm text-text-3">
        OpenRouter returned an empty catalog.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <span className="rounded bg-bg-1 px-2 py-0.5 text-[12px] text-text-2">
          {enabledCount} of {catalog.length} enabled
        </span>
      </div>

      <div className="flex flex-col gap-2 sm:flex-row">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-3" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by model id, name, or description…"
            className="w-full rounded-md border border-border-2 bg-bg-white py-2 pl-9 pr-3 text-[14px] text-text-1 outline-none placeholder:text-text-3 focus:border-primary-6"
          />
        </div>
        <select
          value={provider}
          onChange={(e) => setProvider(e.target.value)}
          className="cursor-pointer rounded-md border border-border-2 bg-bg-white px-3 py-2 text-[14px] text-text-1 outline-none focus:border-primary-6"
        >
          <option value="all">All providers</option>
          {providers.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
      </div>

      <div className="overflow-hidden rounded-lg border border-border-2 bg-bg-white">
        <table className="w-full min-w-[700px]">
          <thead className="bg-bg-1 text-left text-[12px] uppercase tracking-wide text-text-3">
            <tr>
              <th className="px-4 py-2 font-medium">Model</th>
              <th className="px-4 py-2 font-medium">Provider</th>
              <th className="px-4 py-2 font-medium">Context</th>
              <th className="px-4 py-2 font-medium">Prompt $</th>
              <th className="px-4 py-2 font-medium">Completion $</th>
              <th className="px-4 py-2 text-right font-medium">Enabled</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border-2">
            {filtered.map((m) => (
              <CatalogRow
                key={m.id}
                model={m}
                onToggle={(enabled) =>
                  toggleMutation.mutate({ id: m.id, enabled })
                }
                disabled={toggleMutation.isPending}
              />
            ))}
            {filtered.length === 0 && (
              <tr>
                <td
                  colSpan={6}
                  className="px-4 py-8 text-center text-[13px] text-text-3"
                >
                  No models match your filter.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function CatalogRow({
  model,
  onToggle,
  disabled,
}: {
  model: CatalogModel;
  onToggle: (enabled: boolean) => void;
  disabled: boolean;
}) {
  return (
    <tr className="text-[13px]">
      <td className="px-4 py-3">
        <div className="flex flex-col">
          <span className="font-medium text-text-1">{model.name}</span>
          <span className="truncate text-[11px] text-text-3">{model.id}</span>
        </div>
      </td>
      <td className="px-4 py-3 text-text-2">{getProvider(model.id)}</td>
      <td className="px-4 py-3 text-text-2">
        {model.context_length
          ? `${model.context_length.toLocaleString()} tok`
          : "—"}
      </td>
      <td className="px-4 py-3 text-text-2">
        {formatPricePerMillion(model.pricing?.prompt)}
      </td>
      <td className="px-4 py-3 text-text-2">
        {formatPricePerMillion(model.pricing?.completion)}
      </td>
      <td className="px-4 py-3 text-right">
        <Switch
          checked={model.enabled}
          onCheckedChange={onToggle}
          disabled={disabled}
        />
      </td>
    </tr>
  );
}
