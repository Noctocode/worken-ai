export const MODELS = [
  {
    id: "tngtech/deepseek-r1t2-chimera:free",
    label: "DeepSeek R1T2 Chimera",
  },
  {
    id: "arcee-ai/trinity-large-preview:free",
    label: "Trinity Large Preview",
  },
] as const;

export const MODEL_LABELS: Record<string, string> = Object.fromEntries(
  MODELS.map((m) => [m.id, m.label])
);
