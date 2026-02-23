export const MODELS = [
  {
    id: "stepfun/step-3.5-flash:free",
    label: "Step-3.5 Flash",
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
