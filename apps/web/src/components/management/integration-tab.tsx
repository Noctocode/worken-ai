"use client";

import { useState } from "react";
import { BookOpen, Loader2, Plus, Trash2 } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { SearchInput } from "@/components/ui/search-input";
import { Switch } from "@/components/ui/switch";
import { SettingsDialog } from "@/components/settings-dialog";
import {
  deleteIntegration,
  fetchIntegrations,
  updateIntegration,
  upsertIntegration,
  type IntegrationCard,
} from "@/lib/api";

/* ─── Icons ──────────────────────────────────────────────────────────────
 *
 * The brand SVGs live in the FE because they're visual assets, not data.
 * Each predefined provider in the BE catalog carries an `iconHint` string
 * (e.g. "gemini", "openai") that we switch on here. Custom LLMs and
 * unknown hints get a neutral fallback.
 */

function GeminiIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none">
      <defs>
        <linearGradient id="gemini-grad" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#4285F4" />
          <stop offset="100%" stopColor="#A142F4" />
        </linearGradient>
      </defs>
      <path
        d="M12 2C12 2 7 7 7 12C7 17 12 22 12 22C12 22 17 17 17 12C17 7 12 2 12 2Z"
        fill="url(#gemini-grad)"
      />
      <path
        d="M2 12C2 12 7 7 12 7C17 7 22 12 22 12C22 12 17 17 12 17C7 17 2 12 2 12Z"
        fill="url(#gemini-grad)"
        opacity="0.6"
      />
    </svg>
  );
}

function BrandIcon({ color, letter }: { color: string; letter: string }) {
  return (
    <div
      className="flex h-5 w-5 items-center justify-center rounded-sm text-[10px] font-bold text-white"
      style={{ backgroundColor: color }}
    >
      {letter}
    </div>
  );
}

function iconForHint(hint: string): React.ReactNode {
  switch (hint) {
    case "gemini":
      return <GeminiIcon />;
    case "chatgpt":
      return <BrandIcon color="#10a37f" letter="G" />;
    case "deepseek":
      return <BrandIcon color="#1a73e8" letter="D" />;
    case "mistral":
      return <BrandIcon color="#f7931e" letter="M" />;
    case "claude":
      return <BrandIcon color="#d97706" letter="C" />;
    case "perplexity":
      return <BrandIcon color="#20b2aa" letter="P" />;
    case "qwen":
      return <BrandIcon color="#7c3aed" letter="Q" />;
    case "copilot":
      return <BrandIcon color="#0078d4" letter="Co" />;
    case "grok":
      return <BrandIcon color="#1a1a1a" letter="X" />;
    case "custom":
    default:
      return <BrandIcon color="#64748b" letter="·" />;
  }
}

/* ─── Provider Settings (BYOK) dialog ───────────────────────────────── */

function ProviderSettingsDialog({
  card,
  onClose,
}: {
  card: IntegrationCard;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [useOwnKey, setUseOwnKey] = useState(card.hasApiKey);
  const [apiKey, setApiKey] = useState("");
  const [enabled, setEnabled] = useState(card.isEnabled);

  const saveMutation = useMutation({
    mutationFn: async () => {
      // Card has no DB row yet (untouched predefined): create on first save.
      // Otherwise patch the existing one.
      if (card.id) {
        return updateIntegration(card.id, {
          isEnabled: enabled,
          apiKey: useOwnKey ? (apiKey || undefined) : null,
        });
      }
      return upsertIntegration({
        providerId: card.providerId,
        apiKey: useOwnKey && apiKey ? apiKey : undefined,
        isEnabled: enabled,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["integrations"] });
      toast.success(`${card.displayName} settings saved.`);
      onClose();
    },
    onError: (err: Error) => {
      toast.error(err.message ?? "Couldn't save settings.");
    },
  });

  const successRatePct = (card.stats.successRate * 100).toFixed(1);

  return (
    <SettingsDialog
      open
      onClose={onClose}
      onApply={() => saveMutation.mutate()}
      title={card.displayName}
      description={`Configure ${card.displayName} integration settings.`}
      headerIcon={iconForHint(card.iconHint)}
      headerContent={
        <Switch checked={enabled} onCheckedChange={setEnabled} />
      }
    >
      <div className="space-y-5">
        {/* Stats row */}
        <div className="flex items-start gap-8">
          <div>
            <p className="text-[16px] font-normal text-text-1 mb-0.5">
              Success rate:
            </p>
            <p className="text-[18px] font-bold text-text-1">{successRatePct}%</p>
          </div>
          <div>
            <p className="text-[16px] font-normal text-text-1 mb-0.5">
              API calls:
            </p>
            <p className="text-[18px] font-bold text-text-1">
              {card.stats.apiCalls.toLocaleString()}
            </p>
          </div>
          <div>
            <p className="text-[16px] font-normal text-text-1 mb-0.5">
              Rate limit:
            </p>
            <p className="text-[18px] font-bold text-text-1">
              {card.stats.rateLimit.toLocaleString()}
              <span className="text-[13px] font-normal text-text-3 ml-2">
                requests/day
              </span>
            </p>
          </div>
        </div>

        {/* WorkenAI default note */}
        <div>
          <p className="text-[14px] font-normal leading-[20px] text-text-2 mb-1.5">
            Use WORKENAI API
          </p>
          <textarea
            readOnly
            className="w-full rounded-lg bg-bg-3 px-[17px] py-[13px] text-[16px] leading-[24px] text-text-1 resize-none outline-none"
            rows={1}
            defaultValue="Additional costs on the WorkenAI subscription will be added."
          />
        </div>

        {/* Own API key */}
        <div className="space-y-2">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={useOwnKey}
              onChange={(e) => setUseOwnKey(e.target.checked)}
              className="h-3.5 w-3.5 rounded-[5px] border border-border-4 accent-success-7 cursor-pointer"
            />
            <span className="text-[14px] font-normal leading-[20px] text-text-2">
              Use your own API KEY
            </span>
          </label>
          {useOwnKey && (
            <input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder={
                card.hasApiKey
                  ? "Enter a new key to replace the saved one"
                  : "Enter your API key"
              }
              className="w-full h-[50px] rounded-lg border border-border-3 bg-transparent px-[17px] py-[13px] text-[16px] leading-[24px] text-text-1 outline-none focus:border-ring focus:ring-[1px] focus:ring-ring/50"
            />
          )}
        </div>

        <p className="text-[16px] font-normal leading-[24px] text-text-1">
          API calls will incur a small Technology fee.
        </p>
      </div>
    </SettingsDialog>
  );
}

/* ─── Add Custom LLM dialog ─────────────────────────────────────────── */

function AddCustomLLMDialog({ onClose }: { onClose: () => void }) {
  const [apiUrl, setApiUrl] = useState("");
  const queryClient = useQueryClient();

  const createMutation = useMutation({
    mutationFn: () =>
      upsertIntegration({
        providerId: "custom",
        apiUrl: apiUrl.trim(),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["integrations"] });
      toast.success("Custom LLM added.");
      onClose();
    },
    onError: (err: Error) => {
      toast.error(err.message ?? "Couldn't add custom LLM.");
    },
  });

  return (
    <SettingsDialog
      open
      onClose={onClose}
      onApply={() => createMutation.mutate()}
      title="Add Custom LLM"
    >
      <div className="space-y-4">
        <div>
          <p className="text-[14px] font-normal text-text-2 mb-1.5">API Link</p>
          <input
            type="text"
            value={apiUrl}
            onChange={(e) => setApiUrl(e.target.value)}
            placeholder="Put link here"
            className="w-full h-[50px] rounded-lg border border-border-3 bg-transparent px-[17px] py-[13px] text-[13px] text-text-1 placeholder:text-text-3 placeholder:text-[13px] placeholder:font-normal outline-none focus:border-ring focus:ring-[1px] focus:ring-ring/50"
          />
        </div>
        <button
          type="button"
          className="inline-flex h-[48px] items-center gap-2 rounded-md border border-border-2 px-4 text-[16px] font-normal text-text-1 hover:bg-bg-1 transition-colors"
          onClick={() =>
            window.open(
              "https://openrouter.ai/docs/api-reference/overview",
              "_blank",
              "noopener,noreferrer",
            )
          }
        >
          <BookOpen className="h-4 w-4 text-success-7" />
          Integration documentation
        </button>
      </div>
    </SettingsDialog>
  );
}

/* ─── Main tab ──────────────────────────────────────────────────────── */

export function IntegrationTab() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<IntegrationCard | null>(null);
  const [showAddDialog, setShowAddDialog] = useState(false);

  const {
    data: cards,
    isLoading,
    error,
  } = useQuery({
    queryKey: ["integrations"],
    queryFn: fetchIntegrations,
  });

  // Optimistic-ish toggle: PATCH and let React Query refetch.
  const toggleMutation = useMutation({
    mutationFn: ({ card, next }: { card: IntegrationCard; next: boolean }) => {
      if (card.id) {
        return updateIntegration(card.id, { isEnabled: next });
      }
      return upsertIntegration({
        providerId: card.providerId,
        isEnabled: next,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["integrations"] });
    },
    onError: (err: Error) => {
      toast.error(err.message ?? "Couldn't toggle integration.");
    },
  });

  const deleteCustomMutation = useMutation({
    mutationFn: (id: string) => deleteIntegration(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["integrations"] });
      toast.success("Custom LLM removed.");
    },
    onError: (err: Error) => {
      toast.error(err.message ?? "Couldn't delete.");
    },
  });

  const filtered = (cards ?? []).filter((c) =>
    c.displayName.toLowerCase().includes(search.toLowerCase()),
  );

  return (
    <div className="py-5">
      {/* Toolbar */}
      <div className="flex items-center gap-4 mb-6">
        <SearchInput
          className="flex-1"
          placeholder="Search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <Button variant="plusAction" onClick={() => setShowAddDialog(true)}>
          <Plus className="h-4 w-4 text-white" />
          Add Custom LLM
        </Button>
      </div>

      {/* Loading / error states */}
      {isLoading && (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-text-3" />
        </div>
      )}
      {error && (
        <div className="py-12 text-center text-sm text-danger-6">
          Failed to load integrations. Is the API running?
        </div>
      )}

      {/* Grid */}
      {!isLoading && !error && (
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
          {filtered.map((card) => (
            <div
              key={`${card.providerId}-${card.id ?? "new"}`}
              className="flex flex-col rounded-[4px] border border-border-3 bg-bg-white p-5 h-[165px] cursor-pointer hover:border-border-4 transition-colors"
              onClick={() => setSelected(card)}
            >
              {/* Header: icon + name + toggle */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 min-w-0">
                  {iconForHint(card.iconHint)}
                  <span className="truncate text-[16px] font-normal text-text-1">
                    {card.displayName}
                  </span>
                </div>
                <Switch
                  checked={card.isEnabled}
                  onCheckedChange={(next) =>
                    toggleMutation.mutate({ card, next })
                  }
                  onClick={(e) => e.stopPropagation()}
                  disabled={toggleMutation.isPending}
                />
              </div>

              {/* Description */}
              <p className="mt-3 text-[14px] font-normal text-text-2 line-clamp-2">
                {card.description}
              </p>

              {/* Footer: settings link + (custom only) delete */}
              <div className="mt-auto flex items-center justify-between">
                {card.isCustom && card.id ? (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      if (
                        confirm(`Delete custom LLM "${card.displayName}"?`)
                      ) {
                        deleteCustomMutation.mutate(card.id!);
                      }
                    }}
                    className="text-[13px] text-danger-6 hover:underline inline-flex items-center gap-1"
                    title="Delete custom LLM"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    Delete
                  </button>
                ) : (
                  <span />
                )}
                <span className="text-[14px] font-normal text-text-3">
                  Settings
                </span>
              </div>
            </div>
          ))}

          {filtered.length === 0 && (
            <div className="col-span-full py-12 text-center text-sm text-text-3">
              No integrations match your search.
            </div>
          )}
        </div>
      )}

      {/* Provider settings dialog */}
      {selected && (
        <ProviderSettingsDialog
          card={selected}
          onClose={() => setSelected(null)}
        />
      )}

      {/* Add custom LLM dialog */}
      {showAddDialog && (
        <AddCustomLLMDialog onClose={() => setShowAddDialog(false)} />
      )}
    </div>
  );
}
