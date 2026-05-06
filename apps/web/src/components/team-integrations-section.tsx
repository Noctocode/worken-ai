"use client";

import { useState } from "react";
import { BookOpen, Check, Info, KeyRound, Loader2, Plus } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { DisabledReasonTooltip } from "@/components/ui/tooltip";
import { Switch } from "@/components/ui/switch";
import { SettingsDialog } from "@/components/settings-dialog";
import {
  deleteTeamIntegration,
  fetchTeamIntegrations,
  updateTeamIntegration,
  upsertTeamIntegration,
  type IntegrationCard,
} from "@/lib/api";

/* ─── Icons ──────────────────────────────────────────────────────────── */

function GeminiIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none">
      <defs>
        <linearGradient id="team-gemini-grad" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#4285F4" />
          <stop offset="100%" stopColor="#A142F4" />
        </linearGradient>
      </defs>
      <path
        d="M12 2C12 2 7 7 7 12C7 17 12 22 12 22C12 22 17 17 17 12C17 7 12 2 12 2Z"
        fill="url(#team-gemini-grad)"
      />
      <path
        d="M2 12C2 12 7 7 12 7C17 7 22 12 22 12C22 12 17 17 12 17C7 17 2 12 2 12Z"
        fill="url(#team-gemini-grad)"
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
      return <BrandIcon color="#64748b" letter="·" />;
    default:
      return <BrandIcon color="#64748b" letter="·" />;
  }
}

/* ─── Edit Custom LLM dialog ─────────────────────────────────────────── */

function EditTeamCustomLLMDialog({
  teamId,
  card,
  canManage,
  onClose,
}: {
  teamId: string;
  card: IntegrationCard;
  canManage: boolean;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  // Seed the form from the saved values. apiKey starts blank because
  // we never expose the stored secret — same pattern as the predefined
  // dialog (Replace flow).
  const [customName, setCustomName] = useState(card.displayName);
  const [apiUrl, setApiUrl] = useState(card.apiUrl ?? "");
  const [apiKey, setApiKey] = useState("");
  const [enabled, setEnabled] = useState(card.isEnabled);
  // Same hide-saved-key pattern as the predefined dialog. Reveal the
  // input on Replace; Cancel reverts without touching the saved key.
  const [editingKey, setEditingKey] = useState(!card.hasApiKey);

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!card.id) {
        throw new Error("Internal: custom card has no id.");
      }
      // Send only fields the admin actually changed. Sending undefined
      // tells the BE to leave that field alone (matches the personal
      // tab's update semantic).
      const apiKeyForBE: string | null | undefined = !canManage
        ? undefined
        : editingKey && apiKey
          ? apiKey
          : undefined;
      return updateTeamIntegration(teamId, card.id, {
        isEnabled: enabled !== card.isEnabled ? enabled : undefined,
        apiUrl:
          apiUrl.trim() && apiUrl.trim() !== card.apiUrl
            ? apiUrl.trim()
            : undefined,
        customName:
          customName.trim() && customName.trim() !== card.displayName
            ? customName.trim()
            : undefined,
        apiKey: apiKeyForBE,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["team-integrations", teamId],
      });
      // Member pickers read effective models — refresh so the renamed
      // alias label propagates.
      queryClient.invalidateQueries({ queryKey: ["models", "effective"] });
      toast.success(`${customName || "Custom LLM"} updated.`);
      onClose();
    },
    onError: (err: Error) =>
      toast.error(err.message ?? "Couldn't save Custom LLM."),
  });

  const canSubmit =
    customName.trim().length > 0 && apiUrl.trim().length > 0;

  return (
    <SettingsDialog
      open
      onClose={onClose}
      onApply={canManage ? () => saveMutation.mutate() : undefined}
      applyLabel={saveMutation.isPending ? "Saving…" : "Apply"}
      applyPending={saveMutation.isPending}
      applyDisabled={!canManage || !canSubmit}
      title={`${card.displayName} (Team Custom LLM)`}
      description="Update the URL, key, or display name. The underlying model identifier is preserved so ongoing chats keep working."
      headerIcon={iconForHint(card.iconHint)}
      headerContent={
        <Switch
          checked={enabled}
          disabled={!canManage}
          onCheckedChange={setEnabled}
        />
      }
    >
      <div className="space-y-4">
        <div className="flex items-start gap-2 rounded-lg border border-primary-3 bg-primary-1/40 px-3 py-2">
          <Info className="h-4 w-4 shrink-0 text-primary-7 mt-0.5" />
          <p className="text-[13px] text-primary-7 leading-snug">
            Renaming changes only the label members see in the dropdown.
            The model identifier stays the same so existing
            conversations bound to it keep working.
          </p>
        </div>

        <div>
          <p className="text-[14px] font-normal text-text-2 mb-1.5">
            Display name
          </p>
          <input
            type="text"
            value={customName}
            onChange={(e) => setCustomName(e.target.value)}
            disabled={!canManage}
            className="w-full h-[50px] rounded-lg border border-border-3 bg-transparent px-[17px] py-[13px] text-[14px] text-text-1 outline-none focus:border-ring focus:ring-[1px] focus:ring-ring/50 disabled:opacity-60 disabled:cursor-not-allowed"
          />
        </div>

        <div>
          <p className="text-[14px] font-normal text-text-2 mb-1.5">
            API URL
          </p>
          <input
            type="text"
            value={apiUrl}
            onChange={(e) => setApiUrl(e.target.value)}
            disabled={!canManage}
            className="w-full h-[50px] rounded-lg border border-border-3 bg-transparent px-[17px] py-[13px] text-[13px] text-text-1 outline-none focus:border-ring focus:ring-[1px] focus:ring-ring/50 disabled:opacity-60 disabled:cursor-not-allowed"
          />
        </div>

        <div className="space-y-2">
          <p className="text-[14px] font-normal text-text-2">API key</p>
          {card.hasApiKey && !editingKey && (
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
              {canManage && (
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
              )}
            </div>
          )}
          {(editingKey || !card.hasApiKey) && (
            <>
              <input
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder={
                  card.hasApiKey
                    ? "Enter a new key to replace the saved one"
                    : "Optional — leave blank for anonymous endpoints"
                }
                disabled={!canManage}
                className="w-full h-[50px] rounded-lg border border-border-3 bg-transparent px-[17px] py-[13px] text-[16px] text-text-1 outline-none focus:border-ring focus:ring-[1px] focus:ring-ring/50 disabled:opacity-60 disabled:cursor-not-allowed"
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
      </div>
    </SettingsDialog>
  );
}

/* ─── Add Custom LLM dialog ──────────────────────────────────────────── */

function AddTeamCustomLLMDialog({
  teamId,
  onClose,
}: {
  teamId: string;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [customName, setCustomName] = useState("");
  const [apiUrl, setApiUrl] = useState("");
  const [apiKey, setApiKey] = useState("");

  const createMutation = useMutation({
    mutationFn: () =>
      upsertTeamIntegration(teamId, {
        providerId: "custom",
        apiUrl: apiUrl.trim(),
        apiKey: apiKey.trim() || undefined,
        customName: customName.trim(),
        isEnabled: true,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["team-integrations", teamId],
      });
      // Models picker for team members reads from /models — invalidate
      // so the new alias shows up without a page reload.
      queryClient.invalidateQueries({ queryKey: ["models", "effective"] });
      toast.success(`${customName || "Custom LLM"} added for this team.`);
      onClose();
    },
    onError: (err: Error) =>
      toast.error(err.message ?? "Couldn't add team Custom LLM."),
  });

  const canSubmit =
    customName.trim().length > 0 && apiUrl.trim().length > 0;

  return (
    <SettingsDialog
      open
      onClose={onClose}
      onApply={() => createMutation.mutate()}
      applyLabel={createMutation.isPending ? "Adding…" : "Add"}
      applyPending={createMutation.isPending}
      applyDisabled={!canSubmit}
      title="Add Custom LLM (Team)"
      description="Register an OpenAI-compatible endpoint members can pick from the model dropdown."
    >
      <div className="space-y-4">
        <div className="flex items-start gap-2 rounded-lg border border-primary-3 bg-primary-1/40 px-3 py-2">
          <Info className="h-4 w-4 shrink-0 text-primary-7 mt-0.5" />
          <p className="text-[13px] text-primary-7 leading-snug">
            Members of this team will see this Custom LLM in their
            model picker. Chat calls route through the URL below using
            the (optional) shared API key. Per-member caps still apply.
          </p>
        </div>

        <div>
          <p className="text-[14px] font-normal text-text-2 mb-1.5">
            Display name
          </p>
          <input
            type="text"
            value={customName}
            onChange={(e) => setCustomName(e.target.value)}
            placeholder="e.g. Local Llama 3.1"
            className="w-full h-[50px] rounded-lg border border-border-3 bg-transparent px-[17px] py-[13px] text-[14px] text-text-1 placeholder:text-text-3 outline-none focus:border-ring focus:ring-[1px] focus:ring-ring/50"
          />
          <p className="text-[12px] text-text-3 mt-1">
            What members will see in the model dropdown.
          </p>
        </div>

        <div>
          <p className="text-[14px] font-normal text-text-2 mb-1.5">
            API URL
          </p>
          <input
            type="text"
            value={apiUrl}
            onChange={(e) => setApiUrl(e.target.value)}
            placeholder="https://your-endpoint/v1"
            className="w-full h-[50px] rounded-lg border border-border-3 bg-transparent px-[17px] py-[13px] text-[13px] text-text-1 placeholder:text-text-3 outline-none focus:border-ring focus:ring-[1px] focus:ring-ring/50"
          />
        </div>

        <div>
          <p className="text-[14px] font-normal text-text-2 mb-1.5">
            API key (optional)
          </p>
          <input
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder="Leave blank if the endpoint accepts anonymous"
            className="w-full h-[50px] rounded-lg border border-border-3 bg-transparent px-[17px] py-[13px] text-[16px] text-text-1 outline-none focus:border-ring focus:ring-[1px] focus:ring-ring/50"
          />
        </div>

        <button
          type="button"
          className="inline-flex h-[40px] items-center gap-2 rounded-md border border-border-2 px-4 text-[14px] font-normal text-text-1 hover:bg-bg-1 transition-colors"
          onClick={() =>
            window.open(
              "https://platform.openai.com/docs/api-reference/chat",
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

/* ─── Configure dialog ───────────────────────────────────────────────── */

function TeamProviderDialog({
  teamId,
  card,
  canManage,
  onClose,
}: {
  teamId: string;
  card: IntegrationCard;
  canManage: boolean;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [useOwnKey, setUseOwnKey] = useState(card.hasApiKey);
  const [apiKey, setApiKey] = useState("");
  const [enabled, setEnabled] = useState(card.isEnabled);
  // Mirror the personal Integration tab pattern: when a key is already
  // saved, show a "configured" status panel by default and only reveal
  // the input on Replace. Avoids overtyping a working key by accident.
  const [editingKey, setEditingKey] = useState(!card.hasApiKey);

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (card.id) {
        return updateTeamIntegration(teamId, card.id, {
          isEnabled: enabled,
          // Same 3-state semantic as the personal dialog: undefined →
          // leave the saved key alone; null → explicit clear (when the
          // admin unticks "Use the team's own API KEY"); string → save
          // a new key.
          apiKey: !useOwnKey
            ? null
            : editingKey && apiKey
              ? apiKey
              : undefined,
        });
      }
      return upsertTeamIntegration(teamId, {
        providerId: card.providerId,
        apiKey: useOwnKey && apiKey ? apiKey : undefined,
        isEnabled: enabled,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["team-integrations", teamId],
      });
      toast.success(
        editingKey && apiKey && useOwnKey
          ? `${card.displayName} key saved for this team.`
          : `${card.displayName} settings saved.`,
      );
      onClose();
    },
    onError: (err: Error) =>
      toast.error(err.message ?? "Couldn't save team integration."),
  });

  const successRatePct = (card.stats.successRate * 100).toFixed(1);
  // Disclaimer when the provider's BYOK can't be honored end-to-end yet
  // (Anthropic native, Google native, …). The key is stored but chat
  // routing falls back to OpenRouter — surface that to the admin.
  const showCompatibilityNotice = !card.byokSupported && !card.isCustom;

  return (
    <SettingsDialog
      open
      onClose={onClose}
      onApply={canManage ? () => saveMutation.mutate() : undefined}
      applyLabel={saveMutation.isPending ? "Saving…" : "Apply"}
      applyPending={saveMutation.isPending}
      applyDisabled={!canManage}
      title={card.displayName}
      description={`Configure ${card.displayName} integration settings.`}
      headerIcon={iconForHint(card.iconHint)}
      headerContent={
        <Switch
          checked={enabled}
          disabled={!canManage}
          onCheckedChange={setEnabled}
        />
      }
    >
      <div className="space-y-5">
        {showCompatibilityNotice && (
          <div className="flex items-start gap-2 rounded-lg border border-warning-3 bg-warning-1/40 px-3 py-2">
            <Info className="h-4 w-4 shrink-0 text-warning-7 mt-0.5" />
            <p className="text-[13px] text-warning-7 leading-snug">
              {card.displayName}&rsquo;s native API isn&rsquo;t
              OpenAI-compatible yet, so a BYOK key here is stored but chat
              calls still route through the WorkenAI default. We&rsquo;ll
              honor it directly once native support lands.
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

        {/* WorkenAI default note */}
        <div>
          <p className="text-[14px] font-normal leading-[20px] text-text-2 mb-1.5">
            Use WORKENAI API
          </p>
          <div className="w-full rounded-lg bg-bg-3 px-[17px] py-[13px] text-[15px] leading-[22px] text-text-1">
            Additional costs on the WorkenAI subscription will be added.
          </div>
        </div>

        {/* Team's own API key */}
        <div className="space-y-2">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={useOwnKey}
              disabled={!canManage}
              onChange={(e) => {
                setUseOwnKey(e.target.checked);
                // Toggling off and back on resets the editor — keeps
                // the "key already saved" path visible until the admin
                // explicitly clicks Replace.
                if (!e.target.checked) {
                  setEditingKey(true);
                  setApiKey("");
                } else {
                  setEditingKey(!card.hasApiKey);
                }
              }}
              className="h-3.5 w-3.5 rounded-[5px] border border-border-4 accent-success-7 cursor-pointer disabled:cursor-not-allowed"
            />
            <span className="text-[14px] font-normal leading-[20px] text-text-2">
              Use your own API KEY
            </span>
          </label>

          {useOwnKey && card.hasApiKey && !editingKey && (
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
              {canManage && (
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
              )}
            </div>
          )}

          {useOwnKey && (editingKey || !card.hasApiKey) && (
            <>
              <input
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                disabled={!canManage}
                placeholder={
                  card.hasApiKey
                    ? "Enter a new key to replace the saved one"
                    : "Enter your API key"
                }
                className="w-full h-[50px] rounded-lg border border-border-3 bg-transparent px-[17px] py-[13px] text-[16px] leading-[24px] text-text-1 outline-none focus:border-ring focus:ring-[1px] focus:ring-ring/50 disabled:opacity-60 disabled:cursor-not-allowed"
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

/* ─── Section ────────────────────────────────────────────────────────── */

export function TeamIntegrationsSection({
  teamId,
  canManage,
}: {
  teamId: string;
  canManage: boolean;
}) {
  const queryClient = useQueryClient();
  const { data: cards = [], isLoading } = useQuery({
    queryKey: ["team-integrations", teamId],
    queryFn: () => fetchTeamIntegrations(teamId),
  });
  const [openCard, setOpenCard] = useState<IntegrationCard | null>(null);

  // Show only providers that are configured (have a key OR have ever been
  // touched) plus an "Add Provider" button to bring in new ones. The full
  // catalog lives in the dialog so the section stays focused on what the
  // team actively uses.
  const configured = cards.filter((c) => c.id !== null);
  const unconfigured = cards.filter((c) => c.id === null);

  // Cleanup: remove the row entirely. Drops the team's BYOK config for
  // that provider — chat routing falls back to user-personal BYOK or
  // OpenRouter on the next call.
  const removeMutation = useMutation({
    mutationFn: ({ integrationId }: { integrationId: string }) =>
      deleteTeamIntegration(teamId, integrationId),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["team-integrations", teamId],
      });
      toast.success("Team integration removed.");
    },
    onError: (err: Error) =>
      toast.error(err.message ?? "Couldn't remove team integration."),
  });

  const [pickerOpen, setPickerOpen] = useState(false);
  const [customDialogOpen, setCustomDialogOpen] = useState(false);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="space-y-1">
          <p className="text-[18px] font-bold text-text-1">
            AI Provider Keys
          </p>
          <p className="text-[13px] text-text-3">
            Share an API key with the whole team. Chat calls from any
            member route through this key before falling back to their
            personal BYOK or the WorkenAI default.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {canManage ? (
            <>
              <Button
                variant="outline"
                className="rounded-lg"
                onClick={() => setCustomDialogOpen(true)}
              >
                <Plus className="h-4 w-4" />
                Add Custom LLM
              </Button>
              <Button
                variant="plusAction"
                className="rounded-lg"
                disabled={unconfigured.length === 0}
                onClick={() => setPickerOpen(true)}
              >
                <Plus className="h-4 w-4 text-text-white" />
                Add Provider Key
              </Button>
            </>
          ) : (
            <DisabledReasonTooltip
              disabled
              reason="Not available for basic users"
            >
              <Button
                variant="plusAction"
                className="rounded-lg disabled:opacity-50 disabled:cursor-not-allowed"
                disabled
              >
                <Plus className="h-4 w-4 text-text-white" />
                Add Provider Key
              </Button>
            </DisabledReasonTooltip>
          )}
        </div>
      </div>

      {isLoading ? (
        <div className="bg-bg-white rounded p-8 flex justify-center">
          <Loader2 className="h-5 w-5 animate-spin text-text-3" />
        </div>
      ) : configured.length === 0 ? (
        <div className="bg-bg-white rounded overflow-hidden">
          <div className="px-4 py-8 text-center text-[16px] text-text-3">
            No team-shared keys yet. Add one above to share a single
            provider API key with all members.
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {configured.map((card) => (
            // `card.id` is non-null here because `configured` filters
            // for it; falling back to providerId would collide for
            // multiple Custom LLMs (all share providerId="custom"),
            // so always prefer the row id.
            <div
              key={card.id ?? card.providerId}
              className="bg-bg-white rounded p-4 space-y-3"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2.5 min-w-0">
                  {iconForHint(card.iconHint)}
                  <div className="min-w-0">
                    <p className="text-[15px] font-semibold text-text-1 truncate">
                      {card.displayName}
                    </p>
                    <p className="text-[12px] text-text-3 truncate">
                      {card.description}
                    </p>
                  </div>
                </div>
                {card.hasApiKey ? (
                  <span className="rounded-md bg-success-1 px-2 py-0.5 text-[11px] font-medium text-success-7 whitespace-nowrap">
                    Key set
                  </span>
                ) : (
                  <span className="rounded-md bg-bg-2 px-2 py-0.5 text-[11px] text-text-3 whitespace-nowrap">
                    No key
                  </span>
                )}
              </div>
              <div className="flex items-center justify-between text-[12px] text-text-3">
                <span>{card.isEnabled ? "Enabled" : "Disabled"}</span>
                {/* Team-scoped usage. Numbers come from
                    observability_events filtered by team_id, so they
                    reflect everyone in the team, not just the viewer. */}
                <span className="tabular-nums">
                  {card.stats.apiCalls.toLocaleString()} calls/mo
                  {card.stats.successRate > 0 && (
                    <>
                      {" · "}
                      {(card.stats.successRate * 100).toFixed(0)}% ok
                    </>
                  )}
                </span>
              </div>
              <div className="flex items-center justify-end gap-2 -mt-1">
                <div className="flex items-center gap-2">
                  {/* Configure routes to a different dialog for custom
                      vs predefined: predefined edits the BYOK key for
                      a fixed provider; custom edits URL + display name
                      + key. Both flows preserve the underlying
                      modelIdentifier so ongoing chats keep working. */}
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 text-[13px]"
                    onClick={() => setOpenCard(card)}
                  >
                    {canManage ? "Configure" : "View"}
                  </Button>
                  {canManage && card.id && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 text-[13px] text-danger-6 hover:text-danger-7"
                      disabled={removeMutation.isPending}
                      onClick={() => {
                        const what = card.isCustom
                          ? `the "${card.displayName}" Custom LLM`
                          : `the ${card.displayName} team key`;
                        const consequence = card.isCustom
                          ? "Members will lose access to this endpoint."
                          : "Members will fall back to their personal keys or the WorkenAI default.";
                        if (confirm(`Remove ${what}? ${consequence}`)) {
                          removeMutation.mutate({ integrationId: card.id! });
                        }
                      }}
                    >
                      Remove
                    </Button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Add-provider picker — lists all providers without a row yet. */}
      {pickerOpen && (
        <SettingsDialog
          open
          onClose={() => setPickerOpen(false)}
          title="Add Provider Key"
          description="Pick a provider to configure for the team."
        >
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {unconfigured.map((card) => (
              <button
                key={card.providerId}
                type="button"
                onClick={() => {
                  setPickerOpen(false);
                  setOpenCard(card);
                }}
                className="flex items-center gap-2.5 rounded-lg border border-border-2 p-3 text-left hover:bg-bg-1 transition-colors"
              >
                {iconForHint(card.iconHint)}
                <div className="min-w-0">
                  <p className="text-[14px] font-medium text-text-1 truncate">
                    {card.displayName}
                  </p>
                  <p className="text-[12px] text-text-3 truncate">
                    {card.description}
                  </p>
                </div>
              </button>
            ))}
            {unconfigured.length === 0 && (
              <p className="col-span-full text-center text-[14px] text-text-3 py-4">
                Every supported provider already has a team row. Configure
                an existing one to set its key.
              </p>
            )}
          </div>
        </SettingsDialog>
      )}

      {openCard &&
        (openCard.isCustom ? (
          <EditTeamCustomLLMDialog
            teamId={teamId}
            card={openCard}
            canManage={canManage}
            onClose={() => setOpenCard(null)}
          />
        ) : (
          <TeamProviderDialog
            teamId={teamId}
            card={openCard}
            canManage={canManage}
            onClose={() => setOpenCard(null)}
          />
        ))}

      {customDialogOpen && (
        <AddTeamCustomLLMDialog
          teamId={teamId}
          onClose={() => setCustomDialogOpen(false)}
        />
      )}
    </div>
  );
}
