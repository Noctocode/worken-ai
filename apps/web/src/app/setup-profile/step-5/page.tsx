"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useOnboarding } from "../layout";
import { OnboardingExit } from "../onboarding-exit";
import { useLanguage } from "@/lib/i18n";

type ProviderId = "openai" | "azure" | "anthropic" | "private-vpc";

// `available: true` means the provider flows end-to-end through
// onboarding → integrations table → chat-transport BYOK. Marked
// providers persist the typed key, the others render with a
// "Coming soon" pill and a disabled input — they need extra fields
// (Azure deployment URL, VPC endpoint) the wizard doesn't collect
// yet, so the typed key would be dropped on the BE. Showing the
// state honestly avoids the "I configured Azure but chat doesn't
// route through it" confusion.
const PROVIDERS: Array<{
  id: ProviderId;
  name: string;
  models: string;
  placeholder: string;
  available: boolean;
}> = [
  {
    id: "openai",
    name: "OpenAI",
    models: "GPT-4, GPT-3.5",
    placeholder: "sk-proj-…",
    available: true,
  },
  {
    id: "azure",
    name: "Azure OpenAI",
    models: "Enterprise GPT-4",
    placeholder: "Azure deployment key (32-char hex)",
    available: false,
  },
  {
    id: "anthropic",
    name: "Anthropic",
    models: "Claude 3 Opus",
    placeholder: "sk-ant-api03-…",
    available: true,
  },
  {
    id: "private-vpc",
    name: "Private VPC",
    models: "Mistral, Llama",
    placeholder: "Endpoint URL or bearer token",
    available: false,
  },
];

export default function SetupProfileStep5Page() {
  const router = useRouter();
  const { state, setApiKey } = useOnboarding();
  const { t } = useLanguage();
  const [expanded, setExpanded] = useState<ProviderId | null>("openai");
  const apiKeys = state.apiKeys;

  return (
    <div className="flex min-h-screen w-full flex-col items-center justify-center gap-2.5 bg-bg-1 bg-[url('/login-bg.png')] bg-cover bg-center bg-no-repeat px-4 py-8">
      <Card className="w-full max-w-[900px] flex flex-col items-center gap-8 p-[30px] bg-bg-white rounded-md">
        <Image
          src="/full-logo.png"
          alt="WorkenAI"
          width={106}
          height={29}
          priority
        />

        <div className="w-full flex flex-col gap-8">
          <div className="flex flex-col gap-2">
            <h1 className="text-[32px] font-bold leading-tight text-text-1 text-center">
              {t("onboarding.step5.title")}
            </h1>
            <p className="text-[18px] font-normal leading-snug text-text-2 text-center">
              {t("onboarding.step5.subtitle")}
            </p>
          </div>

          <div className="flex flex-col gap-2">
            {PROVIDERS.map(({ id, name, models, placeholder, available }) => {
              const isExpanded = expanded === id;
              return (
                <div
                  key={id}
                  className={`rounded bg-bg-white p-4 transition-colors ${
                    isExpanded
                      ? "border-[1.5px] border-primary-6"
                      : "border border-border-2"
                  } ${available ? "" : "opacity-70"}`}
                >
                  <button
                    type="button"
                    onClick={() => setExpanded(isExpanded ? null : id)}
                    className="flex w-full items-center justify-between"
                  >
                    <div className="flex flex-col gap-0.5 text-left">
                      <div className="flex items-center gap-2">
                        <h3 className="text-[18px] font-bold text-text-1 leading-tight">
                          {name}
                        </h3>
                        {!available && (
                          <span className="rounded-full bg-warning-1 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-warning-7">
                            {t("onboarding.step5.comingSoon")}
                          </span>
                        )}
                      </div>
                      <p className="text-[13px] text-text-3 leading-snug">
                        {models}
                      </p>
                    </div>
                    <ChevronDown
                      className={`h-5 w-5 text-text-3 transition-transform ${
                        isExpanded ? "rotate-180" : ""
                      }`}
                    />
                  </button>

                  {isExpanded && (
                    <div className="mt-4 flex flex-col gap-2 border-t border-border-2 pt-4">
                      <label className="text-sm font-medium text-text-1">
                        {t("onboarding.step5.apiKey")}
                      </label>
                      <Input
                        type="password"
                        // Format-specific placeholder stays visible even
                        // for the coming-soon providers — the
                        // disabled input + the yellow pill on the
                        // header + the help text below already convey
                        // the not-active-yet state, so we can keep the
                        // format hint front and centre.
                        placeholder={placeholder}
                        value={apiKeys[id] ?? ""}
                        onChange={(e) => setApiKey(id, e.target.value)}
                        disabled={!available}
                        className="h-11 text-base rounded-md border-border-3 placeholder:text-text-3 font-mono disabled:cursor-not-allowed disabled:bg-bg-1"
                      />
                      {!available && (
                        <p className="text-[12px] text-text-3 leading-snug">
                          {t("onboarding.step5.comingSoonDesc").replace("{name}", name)}
                        </p>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          <div className="flex justify-between">
            <Button
              variant="ghost"
              className="h-12 w-[75px] rounded-lg text-text-1"
              onClick={() => router.back()}
            >
              {t("common.back")}
            </Button>
            <Button
              className="h-12 w-[127px] rounded-lg bg-primary-6 hover:bg-primary-7 text-text-white"
              onClick={() => router.push("/setup-profile/step-6")}
            >
              {t("common.continue")}
            </Button>
          </div>
        </div>
      </Card>
      <OnboardingExit />
    </div>
  );
}
