"use client";

import { useEffect, useMemo, useState } from "react";
import { Loader2, Search } from "lucide-react";
import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import {
  fetchModelsCatalog,
  setModelEnabled,
  setModelsEnabledBatch,
  type CatalogModel,
} from "@/lib/api";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Pagination } from "@/components/ui/pagination";

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

const checkboxClass =
  "h-4 w-4 cursor-pointer rounded border border-border-3 text-primary-6 accent-primary-6 focus:ring-2 focus:ring-primary-6/30";

export function CatalogTab() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [provider, setProvider] = useState<string>("all");
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const {
    data: catalog,
    isLoading,
    error,
  } = useQuery({
    queryKey: ["models", "catalog"],
    queryFn: fetchModelsCatalog,
    staleTime: 5 * 60 * 1000,
  });

  const invalidateCaches = () => {
    queryClient.invalidateQueries({ queryKey: ["models", "catalog"] });
    queryClient.invalidateQueries({ queryKey: ["models", "available"] });
  };

  const toggleMutation = useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) =>
      setModelEnabled(id, enabled),
    onSuccess: invalidateCaches,
  });

  const batchMutation = useMutation({
    mutationFn: ({ ids, enabled }: { ids: string[]; enabled: boolean }) =>
      setModelsEnabledBatch(ids, enabled),
    onSuccess: () => {
      invalidateCaches();
      setSelected(new Set());
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

  // Catalog can return 100s–1000s of models — pagination is necessary
  // here, not just nice-to-have. Reset to page 1 whenever the filter
  // set changes so the user always lands on populated rows.
  const CATALOG_PAGE_SIZE = 25;
  const [catalogPage, setCatalogPage] = useState(1);
  useEffect(() => {
    setCatalogPage(1);
  }, [search, provider]);
  const catalogTotalPages = Math.max(
    1,
    Math.ceil(filtered.length / CATALOG_PAGE_SIZE),
  );
  const pagedCatalog = useMemo(
    () =>
      filtered.slice(
        (catalogPage - 1) * CATALOG_PAGE_SIZE,
        catalogPage * CATALOG_PAGE_SIZE,
      ),
    [filtered, catalogPage],
  );
  useEffect(() => {
    if (catalogPage > catalogTotalPages) setCatalogPage(catalogTotalPages);
  }, [catalogPage, catalogTotalPages]);

  // Drop selections that are no longer visible (e.g. after the user
  // tightens search/provider filter). Avoids confusing "5 selected" while
  // none of those rows are on screen.
  useEffect(() => {
    if (selected.size === 0) return;
    const visibleIds = new Set(filtered.map((m) => m.id));
    let changed = false;
    const next = new Set<string>();
    selected.forEach((id) => {
      if (visibleIds.has(id)) next.add(id);
      else changed = true;
    });
    if (changed) setSelected(next);
  }, [filtered, selected]);

  const enabledCount = catalog?.filter((m) => m.enabled).length ?? 0;

  const allVisibleSelected =
    filtered.length > 0 && filtered.every((m) => selected.has(m.id));
  const someVisibleSelected = filtered.some((m) => selected.has(m.id));

  const toggleOneSelected = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAllVisible = () => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (allVisibleSelected) {
        filtered.forEach((m) => next.delete(m.id));
      } else {
        filtered.forEach((m) => next.add(m.id));
      }
      return next;
    });
  };

  const bulkAction = (enabled: boolean) => {
    if (selected.size === 0) return;
    batchMutation.mutate({ ids: Array.from(selected), enabled });
  };

  /**
   * One-click admin shortcut: flip every model in the catalog (not just
   * the currently visible/filtered subset) to the given enabled state.
   * Used to bootstrap the workspace ("enable everything, disable a few
   * later") and for a quick reset.
   */
  const setAll = (enabled: boolean) => {
    if (!catalog || catalog.length === 0) return;
    batchMutation.mutate({
      ids: catalog.map((m) => m.id),
      enabled,
    });
  };

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
        Failed to load the AI model catalog. Make sure you&apos;re an admin
        and the API is reachable.
      </div>
    );
  }
  if (!catalog || catalog.length === 0) {
    return (
      <div className="py-16 text-center text-sm text-text-3">
        The AI model catalog is empty.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <span className="rounded bg-bg-1 px-2 py-0.5 text-[12px] text-text-2 w-fit">
          {enabledCount} of {catalog.length} enabled
        </span>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() => setAll(false)}
            disabled={batchMutation.isPending || enabledCount === 0}
            className="cursor-pointer"
          >
            Disable all
          </Button>
          <Button
            size="sm"
            onClick={() => setAll(true)}
            disabled={batchMutation.isPending || enabledCount === catalog.length}
            className="cursor-pointer"
          >
            {batchMutation.isPending ? "Saving…" : "Enable all"}
          </Button>
        </div>
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

      {/* Bulk actions bar */}
      {selected.size > 0 && (
        <div className="flex items-center justify-between rounded-md border border-primary-3 bg-primary-1/40 px-3 py-2">
          <span className="text-[13px] text-text-1">
            <strong>{selected.size}</strong> selected
          </span>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => setSelected(new Set())}
              disabled={batchMutation.isPending}
              className="cursor-pointer"
            >
              Clear
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => bulkAction(false)}
              disabled={batchMutation.isPending}
              className="cursor-pointer"
            >
              Disable
            </Button>
            <Button
              size="sm"
              onClick={() => bulkAction(true)}
              disabled={batchMutation.isPending}
              className="cursor-pointer"
            >
              {batchMutation.isPending ? "Saving…" : "Enable"}
            </Button>
          </div>
        </div>
      )}

      <div className="overflow-hidden rounded-lg border border-border-2 bg-bg-white">
        <table className="w-full min-w-[760px]">
          <thead className="bg-bg-1 text-left text-[12px] uppercase tracking-wide text-text-3">
            <tr>
              <th className="w-[1%] px-4 py-2 font-medium">
                <input
                  type="checkbox"
                  className={checkboxClass}
                  aria-label={
                    allVisibleSelected
                      ? "Deselect all visible models"
                      : "Select all visible models"
                  }
                  checked={allVisibleSelected}
                  ref={(el) => {
                    // Indeterminate state when *some* but not all visible
                    // rows are selected — reads as a partial selection.
                    if (el) {
                      el.indeterminate =
                        someVisibleSelected && !allVisibleSelected;
                    }
                  }}
                  onChange={toggleAllVisible}
                  disabled={filtered.length === 0}
                />
              </th>
              <th className="px-4 py-2 font-medium">Model</th>
              <th className="px-4 py-2 font-medium">Provider</th>
              <th className="px-4 py-2 font-medium">Context</th>
              <th className="px-4 py-2 font-medium">Prompt $</th>
              <th className="px-4 py-2 font-medium">Completion $</th>
              <th className="px-4 py-2 text-right font-medium">Enabled</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border-2">
            {pagedCatalog.map((m) => (
              <CatalogRow
                key={m.id}
                model={m}
                isSelected={selected.has(m.id)}
                onToggleSelect={() => toggleOneSelected(m.id)}
                onToggleEnabled={(enabled) =>
                  toggleMutation.mutate({ id: m.id, enabled })
                }
                disabled={toggleMutation.isPending || batchMutation.isPending}
              />
            ))}
            {filtered.length === 0 && (
              <tr>
                <td
                  colSpan={7}
                  className="px-4 py-8 text-center text-[13px] text-text-3"
                >
                  No models match your filter.
                </td>
              </tr>
            )}
          </tbody>
        </table>
        <Pagination
          page={catalogPage}
          totalPages={catalogTotalPages}
          onPageChange={setCatalogPage}
          className="px-4"
        />
      </div>
    </div>
  );
}

function CatalogRow({
  model,
  isSelected,
  onToggleSelect,
  onToggleEnabled,
  disabled,
}: {
  model: CatalogModel;
  isSelected: boolean;
  onToggleSelect: () => void;
  onToggleEnabled: (enabled: boolean) => void;
  disabled: boolean;
}) {
  return (
    <tr className={`text-[13px] ${isSelected ? "bg-primary-1/30" : ""}`}>
      <td className="px-4 py-3">
        <input
          type="checkbox"
          className={checkboxClass}
          aria-label={`Select ${model.name}`}
          checked={isSelected}
          onChange={onToggleSelect}
        />
      </td>
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
          onCheckedChange={onToggleEnabled}
          disabled={disabled}
        />
      </td>
    </tr>
  );
}
