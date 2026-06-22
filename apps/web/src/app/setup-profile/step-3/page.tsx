"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { UserRound, User as UserIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useOnboarding } from "../layout";
import { OnboardingExit } from "../onboarding-exit";
import { useLanguage } from "@/lib/i18n";

export default function SetupProfileStep3Page() {
  const router = useRouter();
  const { state, update, saveDraft } = useOnboarding();
  const { t } = useLanguage();
  const fullName = state.fullName ?? "";

  // Show inline error only after the first failed Continue — same
  // pattern as step-2 so the form doesn't yell at users the moment
  // they land. Filling the field clears the error live.
  const [attempted, setAttempted] = useState(false);
  const fullNameError = !fullName.trim();

  const handleContinue = () => {
    if (fullNameError) {
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
              {t("onboarding.step3.subtitle")}
            </p>
          </div>

          {/* Selected profile summary (Private Professional) */}
          <div className="flex items-start gap-4 rounded border-[1.5px] border-primary-6 bg-bg-white p-6 text-left">
            <div className="h-10 w-10 shrink-0 rounded bg-bg-1 flex items-center justify-center">
              <UserRound className="h-5 w-5 text-primary-7" strokeWidth={2} />
            </div>
            <div className="flex flex-col gap-1">
              <h3 className="text-base font-bold text-text-1 leading-normal">
                {t("onboarding.step1.personalTitle")}
              </h3>
              <p className="text-[13px] font-medium leading-relaxed text-text-3">
                {t("onboarding.step1.personalDesc")}
              </p>
            </div>
          </div>

          {/* Form */}
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-1">
              <div className="relative">
                <UserIcon className="absolute left-3.5 top-1/2 -translate-y-1/2 h-5 w-5 text-text-3" />
                <Input
                  placeholder={t("onboarding.step3.fullNamePlaceholder")}
                  value={fullName}
                  onChange={(e) => update({ fullName: e.target.value })}
                  aria-invalid={attempted && fullNameError}
                  className="h-11 pl-10 text-base rounded-md border-border-3 placeholder:text-text-3"
                />
              </div>
              {attempted && fullNameError && (
                <p className="text-[12px] text-danger-6">
                  {t("onboarding.step3.fullNameError")}
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
