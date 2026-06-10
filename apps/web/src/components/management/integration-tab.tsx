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
import { DisabledReasonTooltip } from "@/components/ui/tooltip";
import { useAuth } from "@/components/providers";
import { SearchInput } from "@/components/ui/search-input";
import { Switch } from "@/components/ui/switch";
import { SettingsDialog } from "@/components/settings-dialog";
import {
  deleteIntegration,
  fetchIntegrations,
  updateIntegration,
  upsertIntegration,
  type AzureDeployment,
  type IntegrationCard,
  type IntegrationConfig,
} from "@/lib/api";
import { useLanguage } from "@/lib/i18n";
import { invalidateModelMutations } from "@/lib/hooks/use-user-models";
import { isValidAzureEndpoint } from "@/lib/azure";

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
    case "azure":
      return <BrandIcon color="#0078d4" letter="Az" />;
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
  const { t } = useLanguage();
  const queryClient = useQueryClient();
  const [useOwnKey, setUseOwnKey] = useState(card.hasApiKey);
  const [apiKey, setApiKey] = useState("");
  const [enabled, setEnabled] = useState(card.isEnabled);
  // Editing mode: when a key is already saved, show a status panel by
  // default and only reveal the input on explicit "Replace key" click.
  // Avoids the user typing over an already-good key by accident.
  const [editingKey, setEditingKey] = useState(!card.hasApiKey);

  // Azure carries extra config (endpoint / api-version / deployments)
  // the other providers express through a single key. Seeded from the
  // saved config so re-opening the dialog round-trips it.
  const isAzure = card.providerId === "azure";
  const [azureEndpoint, setAzureEndpoint] = useState(
    card.config?.azureEndpoint ?? "",
  );
  const [azureApiVersion, setAzureApiVersion] = useState(
    card.config?.azureApiVersion ?? "2024-10-21",
  );
  const [deployments, setDeployments] = useState<AzureDeployment[]>(
    card.config?.azureDeployments?.length
      ? card.config.azureDeployments
      : [{ deploymentName: "", label: "" }],
  );

  const buildAzureConfig = (): IntegrationConfig => ({
    azureEndpoint: azureEndpoint.trim(),
    azureApiVersion: azureApiVersion.trim(),
    azureDeployments: deployments
      .map((d) => ({
        deploymentName: d.deploymentName.trim(),
        label: d.label.trim() || d.deploymentName.trim(),
      }))
      .filter((d) => d.deploymentName),
  });

  // Client-side Azure validation — mirrors the BE `validateAzureConfig`
  // so a complete config saves and an incomplete one shows exactly
  // what's missing inline (instead of a silent BE 400 that reads as
  // "nothing happened, fields empty on reopen"). The endpoint must be
  // an Azure resource host or the BE rejects it (SSRF guard).
  const azureEndpointTrim = azureEndpoint.trim();
  const azureHostOk = isValidAzureEndpoint(azureEndpointTrim);
  const azureHasDeployment = deployments.some(
    (d) => d.deploymentName.trim() !== "",
  );
  const azureApiVersionOk = azureApiVersion.trim() !== "";
  const azureComplete =
    azureEndpointTrim !== "" &&
    azureHostOk &&
    azureApiVersionOk &&
    azureHasDeployment;
  const azureError = !isAzure
    ? null
    : azureEndpointTrim === ""
      ? t("mgmt.integ.azureNeedEndpoint")
      : !azureHostOk
        ? t("mgmt.integ.azureBadHost")
        : !azureApiVersionOk
          ? t("mgmt.integ.azureNeedApiVersion")
          : !azureHasDeployment
            ? t("mgmt.integ.azureNeedDeployment")
            : null;

  const saveMutation = useMutation({
    mutationFn: async () => {
      const config = isAzure ? buildAzureConfig() : undefined;
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
          config,
        });
      }
      return upsertIntegration({
        providerId: card.providerId,
        apiKey: useOwnKey && apiKey ? apiKey : undefined,
        isEnabled: enabled,
        config,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["integrations"] });
      // Enabling a BYOK provider or saving Azure deployments changes the
      // effective model list (catalog models unlock; azure/<deployment>
      // entries appear), so refresh the picker/arena cache. refetchType
      // 'all' is required — the arena is unmounted while we're here.
      invalidateModelMutations(queryClient);
      toast.success(
        editingKey && apiKey && useOwnKey
          ? `${card.displayName} ${t("mgmt.integ.keySavedToast")}`
          : `${card.displayName} ${t("mgmt.integ.settingsSavedToast")}`,
      );
      onClose();
    },
    onError: (err: Error) => {
      toast.error(err.message ?? t("mgmt.integ.couldntSave"));
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
      applyLabel={saveMutation.isPending ? t("mgmt.integ.applySaving") : t("mgmt.integ.apply")}
      applyPending={saveMutation.isPending}
      // Azure can't be saved with an incomplete/invalid config — the BE
      // would 400. Block Apply and surface the reason inline instead.
      applyDisabled={isAzure && !azureComplete}
      title={card.displayName}
      description={t("mgmt.integ.settingsTitle").replace("{name}", card.displayName)}
      headerIcon={iconForHint(card.iconHint)}
      headerContent={
        <Switch
          checked={enabled}
          onCheckedChange={setEnabled}
        />
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
              {card.displayName}{t("mgmt.integ.compatibilityPrefix")}
            </p>
          </div>
        )}

        {/* Stats row */}
        <div className="flex items-start gap-8">
          <div>
            <p className="text-[16px] font-normal text-text-1 mb-0.5">
              {t("mgmt.integ.successRate")}
            </p>
            <p className="text-[18px] font-bold text-text-1">{successRatePct}%</p>
          </div>
          <div>
            <p className="text-[16px] font-normal text-text-1 mb-0.5">
              {t("mgmt.integ.apiCalls")}
            </p>
            <p className="text-[18px] font-bold text-text-1">
              {card.stats.apiCalls.toLocaleString()}
            </p>
          </div>
          <div>
            <p className="text-[16px] font-normal text-text-1 mb-0.5">
              {t("mgmt.integ.peakDay")}
            </p>
            <p className="text-[18px] font-bold text-text-1">
              {card.stats.peakDailyCalls.toLocaleString()}
              <span className="text-[13px] font-normal text-text-3 ml-2">
                {t("mgmt.integ.calls30d")}
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
            {t("mgmt.integ.useWorkenai")}
          </p>
          <div className="w-full rounded-lg bg-bg-3 px-[17px] py-[13px] text-[15px] leading-[22px] text-text-1">
            {t("mgmt.integ.additionalCosts")}
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
              {t("mgmt.integ.useOwnKey")}
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
                  {t("mgmt.integ.keyConfigured")}
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
                {t("mgmt.integ.replace")}
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
                    ? t("mgmt.integ.enterNewKey")
                    : t("mgmt.integ.enterApiKey")
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
                  {t("mgmt.integ.cancelKeepKey")}
                </button>
              )}
            </>
          )}
        </div>

        {/* Azure OpenAI resource config. Unlike a single-key provider,
            Azure needs the per-resource endpoint, an api-version, and at
            least one deployment (each surfaces as a selectable model). */}
        {isAzure && (
          <div className="space-y-3 rounded-lg border border-border-2 p-4">
            <p className="text-[14px] font-semibold text-text-1">
              {t("mgmt.integ.azureTitle")}
            </p>
            <div className="space-y-1.5">
              <label className="text-[13px] text-text-2">
                {t("mgmt.integ.azureEndpoint")}
              </label>
              <input
                type="text"
                value={azureEndpoint}
                onChange={(e) => setAzureEndpoint(e.target.value)}
                placeholder="https://my-resource.openai.azure.com"
                className="w-full h-11 rounded-lg border border-border-3 bg-transparent px-3 text-[15px] font-mono text-text-1 outline-none focus:border-ring focus:ring-[1px] focus:ring-ring/50"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-[13px] text-text-2">
                {t("mgmt.integ.azureApiVersion")}
              </label>
              <input
                type="text"
                value={azureApiVersion}
                onChange={(e) => setAzureApiVersion(e.target.value)}
                placeholder="2024-10-21"
                className="w-full h-11 rounded-lg border border-border-3 bg-transparent px-3 text-[15px] font-mono text-text-1 outline-none focus:border-ring focus:ring-[1px] focus:ring-ring/50"
              />
            </div>
            <div className="space-y-2">
              <label className="text-[13px] text-text-2">
                {t("mgmt.integ.azureDeployments")}
              </label>
              {deployments.map((d, i) => (
                <div key={i} className="flex items-center gap-2">
                  <input
                    type="text"
                    value={d.deploymentName}
                    onChange={(e) =>
                      setDeployments((prev) =>
                        prev.map((x, j) =>
                          j === i
                            ? { ...x, deploymentName: e.target.value }
                            : x,
                        ),
                      )
                    }
                    placeholder={t("mgmt.integ.azureDeploymentName")}
                    className="h-10 flex-1 rounded-lg border border-border-3 bg-transparent px-3 text-[14px] font-mono text-text-1 outline-none focus:border-ring focus:ring-[1px] focus:ring-ring/50"
                  />
                  <input
                    type="text"
                    value={d.label}
                    onChange={(e) =>
                      setDeployments((prev) =>
                        prev.map((x, j) =>
                          j === i ? { ...x, label: e.target.value } : x,
                        ),
                      )
                    }
                    placeholder={t("mgmt.integ.azureDeploymentLabel")}
                    className="h-10 flex-1 rounded-lg border border-border-3 bg-transparent px-3 text-[14px] text-text-1 outline-none focus:border-ring focus:ring-[1px] focus:ring-ring/50"
                  />
                  <button
                    type="button"
                    onClick={() =>
                      setDeployments((prev) =>
                        prev.filter((_, j) => j !== i),
                      )
                    }
                    disabled={deployments.length === 1}
                    className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-text-3 hover:bg-bg-1 hover:text-danger-6 disabled:cursor-not-allowed disabled:opacity-40"
                    title={t("mgmt.integ.azureRemoveDeployment")}
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              ))}
              <button
                type="button"
                onClick={() =>
                  setDeployments((prev) => [
                    ...prev,
                    { deploymentName: "", label: "" },
                  ])
                }
                className="inline-flex items-center gap-1 text-[13px] font-medium text-primary-6 hover:underline"
              >
                <Plus className="h-3.5 w-3.5" />
                {t("mgmt.integ.azureAddDeployment")}
              </button>
            </div>
            <p className="text-[12px] leading-snug text-text-3">
              {t("mgmt.integ.azureHint")}
            </p>
            {azureError && (
              <p className="text-[12px] font-medium leading-snug text-danger-6">
                {azureError}
              </p>
            )}
          </div>
        )}

        <p className="text-[16px] font-normal leading-[24px] text-text-1">
          {t("mgmt.integ.techFee")}
        </p>
      </div>
    </SettingsDialog>
  );
}

/* ─── Add Custom LLM dialog ─────────────────────────────────────────── */

function AddCustomLLMDialog({ onClose }: { onClose: () => void }) {
  const { t } = useLanguage();
  const [customName, setCustomName] = useState("");
  const [customModel, setCustomModel] = useState("");
  const [apiUrl, setApiUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const queryClient = useQueryClient();

  const createMutation = useMutation({
    mutationFn: () =>
      upsertIntegration({
        providerId: "custom",
        apiUrl: apiUrl.trim(),
        apiKey: apiKey.trim() || undefined,
        customName: customName.trim(),
        customModel: customModel.trim(),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["integrations"] });
      // Models picker reads from /models — invalidate so the auto-
      // created alias shows up immediately without a refresh.
      // refetchType 'all' (via the helper) so the arena refetches even
      // while unmounted; this dialog opens from the Integration tab too.
      invalidateModelMutations(queryClient);
      toast.success(`${customName || t("mgmt.integ.customLLMFallback")} ${t("mgmt.integ.addedToast")}`);
      onClose();
    },
    onError: (err: Error) => {
      toast.error(err.message ?? t("mgmt.integ.couldntAdd"));
    },
  });

  const canSubmit =
    customName.trim().length > 0 &&
    customModel.trim().length > 0 &&
    apiUrl.trim().length > 0;

  return (
    <SettingsDialog
      open
      onClose={onClose}
      onApply={() => createMutation.mutate()}
      applyLabel={createMutation.isPending ? t("mgmt.integ.addingDots") : t("mgmt.integ.apply")}
      applyPending={createMutation.isPending}
      applyDisabled={!canSubmit}
      title={t("mgmt.integ.addTitle")}
      description={t("mgmt.integ.addDesc")}
    >
      <div className="space-y-4">
        <div>
          <p className="text-[14px] font-normal text-text-2 mb-1.5">
            {t("mgmt.integ.displayName")}
          </p>
          <input
            type="text"
            value={customName}
            onChange={(e) => setCustomName(e.target.value)}
            placeholder={t("mgmt.integ.displayNamePlaceholder")}
            className="w-full h-[50px] rounded-lg border border-border-3 bg-transparent px-[17px] py-[13px] text-[14px] text-text-1 placeholder:text-text-3 outline-none focus:border-ring focus:ring-[1px] focus:ring-ring/50"
          />
          <p className="text-[12px] text-text-3 mt-1">
            {t("mgmt.integ.displayNameHint")}
          </p>
        </div>
        <div>
          <p className="text-[14px] font-normal text-text-2 mb-1.5">
            {t("mgmt.integ.apiUrl")}
          </p>
          <input
            type="text"
            value={apiUrl}
            onChange={(e) => setApiUrl(e.target.value)}
            placeholder={t("mgmt.integ.apiUrlPlaceholder")}
            className="w-full h-[50px] rounded-lg border border-border-3 bg-transparent px-[17px] py-[13px] text-[13px] text-text-1 placeholder:text-text-3 placeholder:text-[13px] placeholder:font-normal outline-none focus:border-ring focus:ring-[1px] focus:ring-ring/50"
          />
        </div>
        <div>
          <p className="text-[14px] font-normal text-text-2 mb-1.5">
            {t("mgmt.integ.model")}
          </p>
          <input
            type="text"
            value={customModel}
            onChange={(e) => setCustomModel(e.target.value)}
            placeholder={t("mgmt.integ.modelPlaceholder")}
            className="w-full h-[50px] rounded-lg border border-border-3 bg-transparent px-[17px] py-[13px] text-[13px] text-text-1 placeholder:text-text-3 placeholder:text-[13px] placeholder:font-normal outline-none focus:border-ring focus:ring-[1px] focus:ring-ring/50"
          />
          <p className="text-[12px] text-text-3 mt-1">
            {t("mgmt.integ.modelHint")}
          </p>
        </div>
        <div>
          <p className="text-[14px] font-normal text-text-2 mb-1.5">
            {t("mgmt.integ.apiKeyOptional")}
          </p>
          <input
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder={t("mgmt.integ.anonymousPlaceholder")}
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
          {t("mgmt.integ.integDocs")}
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
  const { t } = useLanguage();
  const n = card.boundAliasCount;
  return (
    <SettingsDialog
      open
      onClose={onClose}
      onApply={onConfirm}
      applyLabel={isPending ? t("mgmt.integ.deletingDots") : n > 0 ? t("mgmt.integ.deleteAnyway") : t("mgmt.integ.delete")}
      applyPending={isPending}
      applyVariant="danger"
      title={`${t("mgmt.integ.deleteQuestion")} "${card.displayName}"?`}
    >
      <div className="space-y-3">
        {n > 0 ? (
          <div className="flex items-start gap-2 rounded-lg border border-danger-3 bg-danger-1/40 px-3 py-2">
            <AlertTriangle className="h-4 w-4 shrink-0 text-danger-6 mt-0.5" />
            <p className="text-[13px] text-danger-6 leading-snug">
              <strong>{n}</strong> {n === 1 ? t("mgmt.integ.aliasesSingular") : t("mgmt.integ.aliasesPlural")}{" "}
              {t("mgmt.integ.aliasesToThis")}{" "}
              <strong>{t("mgmt.integ.unlinkThem")}</strong>{" "}
              {t("mgmt.integ.aliasesSuffix")}
            </p>
          </div>
        ) : (
          <p className="text-[14px] text-text-2">
            {t("mgmt.integ.noAliases")}
          </p>
        )}
        <p className="text-[13px] text-text-3">
          {t("mgmt.integ.actionUndo")}
        </p>
      </div>
    </SettingsDialog>
  );
}

/* ─── Main tab ──────────────────────────────────────────────────────── */

export function IntegrationTab() {
  const { t } = useLanguage();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
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

  // Optimistic toggle. Flips isEnabled in the cache before the
  // request lands so the Switch never enters its disabled cursor-
  // not-allowed state during the round trip. On error we roll the
  // cache back; onSettled refetches to catch any drift.
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
    onMutate: async ({ card, next }) => {
      await queryClient.cancelQueries({ queryKey: ["integrations"] });
      const previous = queryClient.getQueryData<IntegrationCard[]>([
        "integrations",
      ]);
      queryClient.setQueryData<IntegrationCard[]>(["integrations"], (old) =>
        old?.map((c) =>
          c.providerId === card.providerId && c.id === card.id
            ? { ...c, isEnabled: next }
            : c,
        ),
      );
      return { previous };
    },
    onError: (err: Error, _vars, ctx) => {
      if (ctx?.previous) {
        queryClient.setQueryData(["integrations"], ctx.previous);
      }
      toast.error(err.message ?? t("mgmt.integ.couldntToggle"));
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["integrations"] });
      // Toggling a provider on/off changes which catalog (and Azure)
      // models the user can pick — keep the arena/picker list in sync.
      invalidateModelMutations(queryClient);
    },
  });

  const deleteCustomMutation = useMutation({
    mutationFn: (id: string) => deleteIntegration(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["integrations"] });
      // Aliases that were bound to this integration just had their
      // integrationId set to null at the DB level — refresh the Models
      // tab (badge disappears) and the arena/picker (the alias may drop
      // out of the effective list). refetchType 'all' covers the arena
      // being unmounted while we're on the Integration tab.
      invalidateModelMutations(queryClient);
      toast.success(t("mgmt.integ.customLLMRemoved"));
      setPendingDelete(null);
    },
    onError: (err: Error) => {
      toast.error(err.message ?? t("mgmt.integ.couldntDelete"));
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
          placeholder={t("mgmt.integ.search")}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        {isAdmin ? (
          <Button variant="plusAction" onClick={() => setShowAddDialog(true)}>
            <Plus className="h-4 w-4 text-white" />
            {t("mgmt.integ.addCustomLLM")}
          </Button>
        ) : (
          <DisabledReasonTooltip
            disabled
            reason={t("mgmt.integ.adminOnly")}
          >
            <Button
              variant="plusAction"
              disabled
              className="disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Plus className="h-4 w-4 text-white" />
              {t("mgmt.integ.addCustomLLM")}
            </Button>
          </DisabledReasonTooltip>
        )}
      </div>

      {/* Loading / error states */}
      {isLoading && (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-text-3" />
        </div>
      )}
      {error && (
        <div className="py-12 text-center text-sm text-danger-6">
          {t("mgmt.integ.failedLoad")}
        </div>
      )}

      {/* Grid */}
      {!isLoading && !error && (
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
          {filtered.map((card) => {
            // Stable key across the lifecycle: predefined rows are
            // identified by providerId (unique per user), custom rows
            // by their UUID. Without this, an untouched predefined
            // card would change key the moment its first toggle
            // creates a DB row (id: null → uuid), unmounting and
            // remounting the card — visible as a blink.
            const cardKey = card.isCustom ? card.id! : card.providerId;
            return (
            <div
              key={cardKey}
              className={`flex flex-col rounded-[4px] border border-border-3 bg-bg-white p-5 h-[165px] transition-colors ${
                isAdmin
                  ? "cursor-pointer hover:border-border-4"
                  : "cursor-not-allowed opacity-80"
              }`}
              onClick={() => isAdmin && setSelected(card)}
              title={isAdmin ? undefined : t("mgmt.integ.changeAdminOnly")}
            >
              {/* Header: icon + name + toggle */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 min-w-0">
                  {iconForHint(card.iconHint)}
                  <span className="truncate text-[16px] font-normal text-text-1">
                    {card.displayName}
                  </span>
                </div>
                <span onClick={(e) => e.stopPropagation()}>
                  <Switch
                    checked={card.isEnabled}
                    onCheckedChange={(next) =>
                      toggleMutation.mutate({ card, next })
                    }
                    disabled={!isAdmin}
                    title={
                      isAdmin
                        ? undefined
                        : t("mgmt.integ.changeAdminOnly")
                    }
                    className={!isAdmin ? "opacity-50 cursor-not-allowed" : ""}
                  />
                </span>
              </div>

              {/* Persistent BYOK indicator: a small "Key set" pill so
                  the user sees the saved state without opening the
                  Settings dialog. */}
              {card.hasApiKey && (
                <span
                  className="mt-2 inline-flex w-fit items-center gap-1 rounded-full bg-success-1 px-2 py-0.5 text-[11px] font-medium text-success-7"
                  title={t("mgmt.integ.keySetTooltip")}
                >
                  <Check className="h-3 w-3" strokeWidth={2.5} />
                  {t("mgmt.integ.keySet")}
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
                      if (!isAdmin) return;
                      setPendingDelete(card);
                    }}
                    disabled={!isAdmin}
                    className={`text-[13px] inline-flex items-center gap-1 ${
                      isAdmin
                        ? "text-danger-6 hover:underline"
                        : "text-danger-6/50 cursor-not-allowed"
                    }`}
                    title={
                      isAdmin
                        ? t("mgmt.integ.deleteCustomLLM")
                        : t("mgmt.integ.deleteAdminOnly")
                    }
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    {t("mgmt.integ.delete")}
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
                  {t("mgmt.integ.settings")}
                </span>
              </div>
            </div>
            );
          })}

          {filtered.length === 0 && (
            <div className="col-span-full py-12 text-center text-sm text-text-3">
              {t("mgmt.integ.noMatch")}
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
