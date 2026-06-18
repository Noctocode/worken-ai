"use client";

import { useParams } from "next/navigation";

import { useLanguage } from "@/lib/i18n";
import { useScheduledPrompt } from "@/lib/hooks/use-scheduled-prompts";
import { AiCronForm } from "../../ai-cron-form";

export default function EditAiCronPage() {
  const { t } = useLanguage();
  const params = useParams<{ id: string }>();
  const id = typeof params.id === "string" ? params.id : undefined;
  const { prompt, isLoading } = useScheduledPrompt(id);

  if (isLoading || !prompt) {
    return (
      <div className="mx-auto w-full max-w-2xl py-8 text-sm text-text-2">
        {isLoading ? "…" : t("aiCron.empty.title")}
      </div>
    );
  }

  return <AiCronForm initial={prompt} />;
}
