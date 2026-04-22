export const MODELS = [
  {
    id: "nvidia/nemotron-3-nano-30b-a3b:free",
    label: "Nemotron 3 Nano 30B",
  },
  {
    id: "arcee-ai/trinity-large-preview:free",
    label: "Trinity Large Preview",
  },
  {
    id: "liquid/lfm-2.5-1.2b-thinking:free",
    label: "LFM 2.5 1.2B Thinking",
  },
] as const;

export const MODEL_LABELS: Record<string, string> = Object.fromEntries(
  MODELS.map((m) => [m.id, m.label])
);
