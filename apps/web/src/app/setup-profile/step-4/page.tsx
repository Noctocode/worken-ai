"use client";

import { useRouter } from "next/navigation";
import Image from "next/image";
import { Cloud, Server, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useOnboarding } from "../layout";

type Infra = "managed" | "on-premise";

const INFRA_OPTIONS: Array<{
  type: Infra;
  title: string;
  subtitle: string;
  icon: typeof Cloud;
  features: string[];
  bestFor: string;
}> = [
  {
    type: "managed",
    title: "Managed Cloud",
    subtitle: "Hosted by WorkenAI",
    icon: Cloud,
    features: [
      "5-minute setup",
      "Automatic scaling",
      "Managed updates",
      "SOC 2 Type II certified",
    ],
    bestFor: "Rapid deployment, minimal DevOps overhead",
  },
  {
    type: "on-premise",
    title: "On-Premise / Private Cloud",
    subtitle: "Your infrastructure",
    icon: Server,
    features: [
      "Full data sovereignty",
      "Air-gapped deployment",
      "Custom compliance",
      "Network isolation",
    ],
    bestFor: "Government, defense, regulated industries",
  },
];

export default function SetupProfileStep4Page() {
  const router = useRouter();
  const { state, update } = useOnboarding();
  const selected: Infra = state.infraChoice ?? "managed";

  return (
    <div className="flex min-h-screen w-full items-center justify-center bg-bg-1 bg-[url('/login-bg.png')] bg-cover bg-center bg-no-repeat px-4 py-8">
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
              Configure your AI Infrastructure
            </h1>
            <p className="text-[18px] font-normal leading-snug text-text-2 text-center">
              Select your preferred vector database hosting model for secure
              AI operations.
            </p>
          </div>

          <div className="flex flex-col md:flex-row gap-6">
            {INFRA_OPTIONS.map(({ type, title, subtitle, icon: Icon, features, bestFor }) => {
              const isSelected = selected === type;
              return (
                <button
                  key={type}
                  type="button"
                  onClick={() => update({ infraChoice: type })}
                  className={`flex-1 flex flex-col gap-4 rounded bg-bg-white p-6 text-left transition-colors ${
                    isSelected
                      ? "border-[1.5px] border-primary-6"
                      : "border border-border-2 hover:border-primary-6"
                  }`}
                >
                  <div className="flex items-center gap-4">
                    <div className="h-[52px] w-[52px] shrink-0 rounded bg-bg-1 flex items-center justify-center">
                      <Icon className="h-6 w-6 text-primary-7" strokeWidth={2} />
                    </div>
                    <div className="flex flex-col">
                      <h3 className="text-[18px] font-bold text-text-1 leading-tight">
                        {title}
                      </h3>
                      <p className="text-base font-medium text-text-3 leading-snug">
                        {subtitle}
                      </p>
                    </div>
                  </div>

                  <ul className="flex flex-col gap-2">
                    {features.map((f) => (
                      <li key={f} className="flex items-center gap-2 text-sm text-text-1">
                        <Check className="h-4 w-4 shrink-0 text-[#23C343]" strokeWidth={2.5} />
                        {f}
                      </li>
                    ))}
                  </ul>

                  <div className="flex flex-col gap-1 border-t border-border-2 pt-4">
                    <span className="text-base font-medium text-text-3">Best For</span>
                    <span className="text-sm text-text-1">{bestFor}</span>
                  </div>
                </button>
              );
            })}
          </div>

          <div className="flex justify-between">
            <Button
              variant="ghost"
              className="h-12 w-[75px] rounded-lg text-text-1"
              onClick={() => router.back()}
            >
              Back
            </Button>
            <Button
              className="h-12 w-[127px] rounded-lg bg-primary-6 hover:bg-primary-7 text-text-white"
              onClick={() => {
                // Persist the visible default if the user never touched the
                // cards — otherwise step 6 would see infraChoice undefined
                // and reject the submit.
                if (!state.infraChoice) update({ infraChoice: selected });
                router.push("/setup-profile/step-5");
              }}
            >
              Continue
            </Button>
          </div>
        </div>
      </Card>
    </div>
  );
}
