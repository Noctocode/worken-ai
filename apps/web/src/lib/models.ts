export const MODELS = [
  {
    id: "minimax/minimax-m2.5:free",
    label: "MiniMax M2.5",
  },
  {
    id: "inclusionai/ling-2.6-flash:free",
    label: "Ling 2.6 Flash",
  },
  {
    id: "liquid/lfm-2.5-1.2b-thinking:free",
    label: "LFM 2.5 1.2B Thinking",
  },
] as const;

export const MODEL_LABELS: Record<string, string> = Object.fromEntries(
  MODELS.map((m) => [m.id, m.label])
);
