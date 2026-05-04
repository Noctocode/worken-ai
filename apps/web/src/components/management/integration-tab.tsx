"use client";

import { useState } from "react";
import {
  AlertTriangle,
  BookOpen,
  Check,
  Info,
  KeyRound,
  Loader2,
  Plus,
  Trash2,
} from "lucide-react";
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
  // Editing mode: when a key is already saved, show a status panel by
  // default and only reveal the input on explicit "Replace key" click.
  // Avoids the user typing over an already-good key by accident.
  const [editingKey, setEditingKey] = useState(!card.hasApiKey);

  const saveMutation = useMutation({
    mutationFn: async () => {
      // Card has no DB row yet (untouched predefined): create on first save.
      // Otherwise patch the existing one.
      if (card.id) {
        return updateIntegration(card.id, {
          isEnabled: enabled,
          // Only send apiKey when user is actually replacing it. Sending
          // `undefined` means "leave existing key alone" (BE PATCH skips
          // it). Sending null = explicit clear.
          apiKey: !useOwnKey
            ? null
            : editingKey && apiKey
              ? apiKey
              : undefined,
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
      toast.success(
        editingKey && apiKey && useOwnKey
          ? `${card.displayName} key saved.`
          : `${card.displayName} settings saved.`,
      );
      onClose();
    },
    onError: (err: Error) => {
      toast.error(err.message ?? "Couldn't save settings.");
    },
  });

  const successRatePct = (card.stats.successRate * 100).toFixed(1);
  // Disclaimer fires when the provider can't honor BYOK end-to-end.
  // openAICompatible=false alone doesn't cut it any more — Anthropic
  // is non-compatible but routes through its native SDK, so the key
  // IS honored. byokSupported is the right flag to gate on.
  const showCompatibilityNotice = !card.byokSupported && !card.isCustom;

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
        {/* Compatibility disclaimer for non-OpenAI-compatible providers
            (Anthropic, Google, Qwen). The BYOK key is saved but chat
            calls keep going through OpenRouter for now — surface that
            so the user knows their key is dormant. */}
        {showCompatibilityNotice && (
          <div className="flex items-start gap-2 rounded-lg border border-warning-3 bg-warning-1/40 px-3 py-2">
            <Info className="h-4 w-4 shrink-0 text-warning-7 mt-0.5" />
            <p className="text-[13px] text-warning-7 leading-snug">
              {card.displayName}&rsquo;s native API isn&rsquo;t OpenAI-compatible
              yet, so a BYOK key here is stored but chat calls still route
              through OpenRouter. We&rsquo;ll honor it directly once native
              support lands.
            </p>
          </div>
        )}

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
              Peak / day:
            </p>
            <p className="text-[18px] font-bold text-text-1">
              {card.stats.peakDailyCalls.toLocaleString()}
              <span className="text-[13px] font-normal text-text-3 ml-2">
                calls (30d max)
              </span>
            </p>
          </div>
        </div>

        {/* WorkenAI default note. Plain div on purpose — using a
            textarea/input here gave it scroll behavior the moment the
            text didn't fit, which we never want. The block now grows
            to fit whatever copy lands in it. */}
        <div>
          <p className="text-[14px] font-normal leading-[20px] text-text-2 mb-1.5">
            Use WORKENAI API
          </p>
          <div className="w-full rounded-lg bg-bg-3 px-[17px] py-[13px] text-[15px] leading-[22px] text-text-1">
            Additional costs on the WorkenAI subscription will be added.
          </div>
        </div>

        {/* Own API key */}
        <div className="space-y-2">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={useOwnKey}
              onChange={(e) => {
                setUseOwnKey(e.target.checked);
                // Toggling off and back on resets the editor — keeps
                // the "key already saved" path visible until the user
                // explicitly clicks Replace.
                if (!e.target.checked) {
                  setEditingKey(true);
                  setApiKey("");
                } else {
                  setEditingKey(!card.hasApiKey);
                }
              }}
              className="h-3.5 w-3.5 rounded-[5px] border border-border-4 accent-success-7 cursor-pointer"
            />
            <span className="text-[14px] font-normal leading-[20px] text-text-2">
              Use your own API KEY
            </span>
          </label>

          {useOwnKey && card.hasApiKey && !editingKey && (
            // Status panel: the user has a key saved already. Show a
            // clear "configured" state with masked dots, plus actions
            // to replace or remove. Without this, after clicking
            // Apply the dialog just closes and there's no visible
            // signal that the key persisted.
            <div className="flex items-center gap-3 rounded-lg border border-success-3 bg-success-1/40 px-4 py-3">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-success-7 text-white">
                <Check className="h-4 w-4" strokeWidth={2.5} />
              </span>
              <div className="flex min-w-0 flex-1 flex-col">
                <span className="text-[13px] font-semibold text-success-7">
                  API key configured
                </span>
                <span className="flex items-center gap-1.5 text-[13px] text-text-2">
                  <KeyRound className="h-3.5 w-3.5 text-text-3" />
                  <span className="font-mono tracking-wide">
                    ••••••••••••••••
                  </span>
                </span>
              </div>
              <button
                type="button"
                onClick={() => {
                  setEditingKey(true);
                  setApiKey("");
                }}
                className="text-[13px] font-medium text-primary-6 hover:underline"
              >
                Replace
              </button>
            </div>
          )}

          {useOwnKey && (editingKey || !card.hasApiKey) && (
            <>
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
              {card.hasApiKey && (
                <button
                  type="button"
                  onClick={() => {
                    setEditingKey(false);
                    setApiKey("");
                  }}
                  className="text-[13px] text-text-3 hover:underline"
                >
                  Cancel — keep the saved key
                </button>
              )}
            </>
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

/* ─── Delete-with-bound-aliases warning ────────────────────────────── */

function DeleteCustomLLMDialog({
  card,
  onClose,
  onConfirm,
  isPending,
}: {
  card: IntegrationCard;
  onClose: () => void;
  onConfirm: () => void;
  isPending: boolean;
}) {
  const n = card.boundAliasCount;
  return (
    <SettingsDialog
      open
      onClose={onClose}
      onApply={onConfirm}
      applyLabel={isPending ? "Deleting…" : n > 0 ? "Delete anyway" : "Delete"}
      applyVariant="danger"
      title={`Delete "${card.displayName}"?`}
    >
      <div className="space-y-3">
        {n > 0 ? (
          <div className="flex items-start gap-2 rounded-lg border border-danger-3 bg-danger-1/40 px-3 py-2">
            <AlertTriangle className="h-4 w-4 shrink-0 text-danger-6 mt-0.5" />
            <p className="text-[13px] text-danger-6 leading-snug">
              <strong>{n}</strong> model alias{n === 1 ? "" : "es"} currently
              route to this Custom LLM. Deleting it will{" "}
              <strong>unlink them</strong> — those aliases will fall back to
              the default routing (OpenRouter), which will likely fail until
              you point them at another endpoint or remove them.
            </p>
          </div>
        ) : (
          <p className="text-[14px] text-text-2">
            This Custom LLM has no aliases bound to it. Removing it now is
            safe.
          </p>
        )}
        <p className="text-[13px] text-text-3">
          The action cannot be undone. The endpoint URL and any saved API
          key are deleted from this workspace.
        </p>
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
  const [pendingDelete, setPendingDelete] = useState<IntegrationCard | null>(
    null,
  );

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
      // Aliases that were bound to this integration just had their
      // integrationId set to null at the DB level — refresh Models tab
      // so the badge disappears immediately.
      queryClient.invalidateQueries({ queryKey: ["models"] });
      toast.success("Custom LLM removed.");
      setPendingDelete(null);
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
                  // Disabled when there's no key on a predefined provider —
                  // a green toggle without a key wouldn't actually route
                  // anything (BYOK falls through to OpenRouter). The user
                  // adds a key first via Settings, which auto-enables.
                  disabled={
                    toggleMutation.isPending ||
                    (!card.isCustom && !card.hasApiKey)
                  }
                  title={
                    !card.isCustom && !card.hasApiKey
                      ? "Add an API key in Settings before enabling — without one, this toggle has no effect."
                      : undefined
                  }
                />
              </div>

              {/* Persistent BYOK indicator: a small "Key set" pill so
                  the user sees the saved state without opening the
                  Settings dialog. */}
              {card.hasApiKey && (
                <span
                  className="mt-2 inline-flex w-fit items-center gap-1 rounded-full bg-success-1 px-2 py-0.5 text-[11px] font-medium text-success-7"
                  title="Your own API key is saved for this provider"
                >
                  <Check className="h-3 w-3" strokeWidth={2.5} />
                  Key set
                </span>
              )}

              {/* Description */}
              <p className="mt-2 text-[14px] font-normal text-text-2 line-clamp-2">
                {card.description}
              </p>

              {/* Footer: settings link + (custom only) delete */}
              <div className="mt-auto flex items-center justify-between">
                {card.isCustom && card.id ? (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setPendingDelete(card);
                    }}
                    className="text-[13px] text-danger-6 hover:underline inline-flex items-center gap-1"
                    title="Delete custom LLM"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    Delete
                    {card.boundAliasCount > 0 && (
                      <span className="ml-1 rounded-full bg-danger-1 px-1.5 py-0 text-[10px] font-medium text-danger-6">
                        {card.boundAliasCount}
                      </span>
                    )}
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

      {/* Delete-with-warning dialog (custom LLMs only) */}
      {pendingDelete && pendingDelete.id && (
        <DeleteCustomLLMDialog
          card={pendingDelete}
          onClose={() => setPendingDelete(null)}
          onConfirm={() => deleteCustomMutation.mutate(pendingDelete.id!)}
          isPending={deleteCustomMutation.isPending}
        />
      )}
    </div>
  );
}
