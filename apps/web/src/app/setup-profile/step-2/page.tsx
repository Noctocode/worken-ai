"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { Building2, User as UserIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useOnboarding } from "../layout";
import { OnboardingExit } from "../onboarding-exit";
import { useLanguage } from "@/lib/i18n";

const TEAM_SIZES = [
  { value: "1-10", label: "1 – 10" },
  { value: "11-50", label: "11 – 50" },
  { value: "51-200", label: "51 – 200" },
  { value: "201-1000", label: "201 – 1,000" },
  { value: "1000+", label: "1,000+" },
];

export default function SetupProfileStep2Page() {
  const router = useRouter();
  const { state, update, saveDraft } = useOnboarding();
  const { t } = useLanguage();

  const INDUSTRIES = [
    { value: "technology", label: t("onboarding.step2.industry.technology") },
    { value: "finance", label: t("onboarding.step2.industry.finance") },
    { value: "healthcare", label: t("onboarding.step2.industry.healthcare") },
    { value: "government", label: t("onboarding.step2.industry.government") },
    { value: "manufacturing", label: t("onboarding.step2.industry.manufacturing") },
    { value: "retail", label: t("onboarding.step2.industry.retail") },
    { value: "other", label: t("onboarding.step2.industry.other") },
  ];
  const companyName = state.companyName ?? "";
  const industry = state.industry ?? "";
  const teamSize = state.teamSize ?? "";

  // Show inline errors only after the user tries to advance — avoids
  // yelling at them the moment they land on the page. After the first
  // failed Continue, subsequent renders re-evaluate per-field so
  // filling a field clears its error live.
  //
  // No "is this company name taken" check here: the tenant is keyed
  // by `companies.id` (UUID) now, not by the display name. Two
  // self-signups with the same string are two distinct tenants —
  // there's nothing to block at this step.
  const [attempted, setAttempted] = useState(false);

  const errors = {
    companyName: !companyName.trim(),
    industry: !industry,
    teamSize: !teamSize,
  };
  const hasError =
    errors.companyName || errors.industry || errors.teamSize;

  const handleContinue = () => {
    if (hasError) {
      setAttempted(true);
      return;
    }
    saveDraft();
    router.push("/setup-profile/step-4");
  };

  return (
    <div className="flex min-h-screen w-full flex-col items-center justify-center gap-2.5 bg-bg-1 bg-[url('/login-bg.png')] bg-cover bg-center bg-no-repeat px-4 py-8">
      <Card className="w-full max-w-[500px] flex flex-col items-center gap-8 p-[30px] bg-bg-white rounded-md">
        <Image
          src="/full-logo.png"
          alt="WorkenAI"
          width={128}
          height={17}
          priority
        />

        <div className="w-full max-w-[400px] flex flex-col gap-8">
          <div className="flex flex-col gap-2">
            <h1 className="text-[32px] font-bold leading-tight text-text-1 text-center">
              {t("onboarding.title")}
            </h1>
            <p className="text-[18px] font-normal leading-snug text-text-2 text-center">
              {t("onboarding.subtitle")}
            </p>
          </div>

          {/* Selected profile summary (Company) */}
          <div className="flex items-start gap-4 rounded border-[1.5px] border-primary-6 bg-bg-white p-6 text-left">
            <div className="h-10 w-10 shrink-0 rounded bg-bg-1 flex items-center justify-center">
              <Building2 className="h-5 w-5 text-primary-7" strokeWidth={2} />
            </div>
            <div className="flex flex-col gap-1">
              <h3 className="text-base font-bold text-text-1 leading-normal">
                {t("onboarding.step1.companyTitle")}
              </h3>
              <p className="text-[13px] font-medium leading-relaxed text-text-3">
                {t("onboarding.step1.companyDesc")}
              </p>
            </div>
          </div>

          {/* Form */}
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-1">
              <div className="relative">
                <UserIcon className="absolute left-3.5 top-1/2 -translate-y-1/2 h-5 w-5 text-text-3" />
                <Input
                  placeholder={t("onboarding.step2.companyNamePlaceholder")}
                  value={companyName}
                  onChange={(e) => update({ companyName: e.target.value })}
                  aria-invalid={attempted && errors.companyName}
                  className="h-11 pl-10 text-base rounded-md placeholder:text-text-3 border-border-3"
                />
              </div>
              {attempted && errors.companyName && (
                <p className="text-[12px] text-danger-6">
                  {t("onboarding.step2.companyNameError")}
                </p>
              )}
            </div>

            <div className="flex flex-col gap-1">
              <Select
                value={industry}
                onValueChange={(v) => update({ industry: v })}
              >
                <SelectTrigger
                  aria-invalid={attempted && errors.industry}
                  className="h-11 w-full rounded-md border-border-2 text-base"
                >
                  <SelectValue placeholder={t("onboarding.step2.industryPlaceholder")} />
                </SelectTrigger>
                <SelectContent>
                  {INDUSTRIES.map((i) => (
                    <SelectItem key={i.value} value={i.value}>
                      {i.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {attempted && errors.industry && (
                <p className="text-[12px] text-danger-6">
                  {t("onboarding.step2.industryError")}
                </p>
              )}
            </div>

            <div className="flex flex-col gap-1">
              <Select
                value={teamSize}
                onValueChange={(v) => update({ teamSize: v })}
              >
                <SelectTrigger
                  aria-invalid={attempted && errors.teamSize}
                  className="h-11 w-full rounded-md border-border-2 text-base"
                >
                  <SelectValue placeholder={t("onboarding.step2.teamSizePlaceholder")} />
                </SelectTrigger>
                <SelectContent>
                  {TEAM_SIZES.map((t) => (
                    <SelectItem key={t.value} value={t.value}>
                      {t.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {attempted && errors.teamSize && (
                <p className="text-[12px] text-danger-6">
                  {t("onboarding.step2.teamSizeError")}
                </p>
              )}
            </div>

            <div className="flex justify-between pt-2">
              <Button
                variant="ghost"
                className="h-12 w-[75px] rounded-lg text-text-1"
                onClick={() => router.back()}
              >
                {t("common.back")}
              </Button>
              <Button
                className="h-12 w-[127px] rounded-lg bg-primary-6 hover:bg-primary-7 text-text-white"
                onClick={handleContinue}
              >
                {t("common.continue")}
              </Button>
            </div>
          </div>
        </div>
      </Card>
      <OnboardingExit />
    </div>
  );
}
