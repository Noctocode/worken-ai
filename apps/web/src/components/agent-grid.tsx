"use client";

import { AGENTS, type AgentPreset } from "@/lib/agents";
import { useAvailableModels } from "@/lib/hooks/use-available-models";
import { useUserModels } from "@/lib/hooks/use-user-models";
import { useLanguage } from "@/lib/i18n";

interface AgentGridProps {
  /** Single-select: the currently highlighted agent. Cards match on
   *  `agent.id`. Ignored when `selectedAgentIds` is provided. */
  selectedAgentId?: string | null;
  /** Multi-select: the set of highlighted agent ids. When provided the
   *  grid switches to multi-select — every card toggles independently
   *  and `onToggle` fires instead of `onSelect`. */
  selectedAgentIds?: string[];
  /** Fired when a card is clicked in single-select mode. Receives the
   *  full preset so the parent can decide what to do with it (set
   *  state, mutate a project, etc.) without re-deriving the model. */
  onSelect?: (agent: AgentPreset) => void;
  /** Fired when a card is toggled in multi-select mode. */
  onToggle?: (agent: AgentPreset) => void;
}

/**
 * Agent picker — a flex-wrapped grid of preset cards with icon, agent
 * label, and the resolved model name (with a `(BYOK)` / `(Custom)`
 * routing suffix so the user can tell which agents bill their own
 * provider key vs the WorkenAI default). Each card's preferred model
 * is looked up in the live catalog; if the slug isn't surfaced, it
 * falls back to the first available model with a "(fallback)" hint.
 *
 * Used by /projects/create (initial agent pick) and by the Change
 * model dialog on the dashboard ProjectCard.
 */
export function AgentGrid({
  selectedAgentId,
  selectedAgentIds,
  onSelect,
  onToggle,
}: AgentGridProps) {
  const { t } = useLanguage();
  const { models: availableModels } = useAvailableModels();
  const { effective: effectiveModels } = useUserModels();

  // Multi-select kicks in as soon as the caller passes an id array.
  const isMulti = selectedAgentIds !== undefined;

  // Routing-aware label suffix. Falls back to "workenai" (no marker)
  // when the slug isn't in the user's effective list — i.e. routes
  // through the WorkenAI default key, not BYOK / Custom.
  const routingSuffix = (modelId: string): string => {
    const m = effectiveModels.find((x) => x.id === modelId);
    if (!m) return "";
    if (m.routing === "byok") return " (BYOK)";
    if (m.routing === "custom") return " (Custom)";
    return "";
  };

  return (
    <div className="flex flex-wrap gap-2.5 justify-center w-full max-w-[900px]">
      {AGENTS.map((agent) => {
        const Icon = agent.icon;
        const isSelected = isMulti
          ? (selectedAgentIds ?? []).includes(agent.id)
          : selectedAgentId === agent.id;
        const resolvedModel =
          availableModels.find((m) => m.id === agent.model) ??
          availableModels[0];
        const willFallback =
          resolvedModel != null && resolvedModel.id !== agent.model;
        const suffix = resolvedModel ? routingSuffix(resolvedModel.id) : "";
        return (
          <button
            key={agent.id}
            type="button"
            onClick={() => (isMulti ? onToggle?.(agent) : onSelect?.(agent))}
            title={
              resolvedModel
                ? willFallback
                  ? t("agentGrid.preferredNotEnabled")
                      .replace("{model}", agent.model)
                      .replace("{fallback}", `${resolvedModel.name}${suffix}`)
                  : t("agentGrid.uses").replace("{model}", `${resolvedModel.name}${suffix}`)
                : agent.model
            }
            className={`flex flex-col items-center gap-2.5 p-4 cursor-pointer transition-colors rounded-lg w-[calc(50%-5px)] sm:w-auto sm:min-w-[200px] sm:flex-1 sm:max-w-[220px] ${
              isSelected
                ? "bg-primary-1 border border-primary-6"
                : "bg-bg-1 border border-transparent hover:border-border-3"
            }`}
          >
            <div className="flex h-[60px] w-[60px] items-center justify-center rounded-xl bg-[rgba(60,126,255,0.2)]">
              <Icon className="h-10 w-10 text-primary-6" />
            </div>
            <span className="text-[13px] text-text-2 text-center leading-tight break-words w-full">
              {agent.label}
            </span>
            {resolvedModel && (
              <span
                className={`text-[11px] truncate max-w-full ${
                  willFallback ? "text-warning-6" : "text-text-3"
                }`}
              >
                {willFallback
                  ? `↳ ${resolvedModel.name}${suffix} ${t("agentGrid.fallback")}`
                  : `${resolvedModel.name}${suffix}`}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
