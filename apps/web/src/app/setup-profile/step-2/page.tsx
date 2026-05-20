"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { Building2, Loader2, User as UserIcon } from "lucide-react";
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
import { checkOnboardingCompanyName } from "@/lib/api";
import { useOnboarding } from "../layout";

const INDUSTRIES = [
  { value: "technology", label: "Technology" },
  { value: "finance", label: "Finance" },
  { value: "healthcare", label: "Healthcare" },
  { value: "government", label: "Government" },
  { value: "manufacturing", label: "Manufacturing" },
  { value: "retail", label: "Retail" },
  { value: "other", label: "Other" },
];

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
  const companyName = state.companyName ?? "";
  const industry = state.industry ?? "";
  const teamSize = state.teamSize ?? "";

  // Show inline errors only after the user tries to advance — avoids
  // yelling at them the moment they land on the page. After the first
  // failed Continue, subsequent renders re-evaluate per-field so
  // filling a field clears its error live.
  const [attempted, setAttempted] = useState(false);

  // Inline "is this company name still free?" check. Debounced 400ms
  // after typing stops so we don't hammer the BE on every keystroke;
  // stale-response guard via the local request token cancels older
  // checks if the user keeps typing past a slow round-trip.
  //   - 'idle'  → no check has fired yet for the current value
  //   - 'check' → in-flight
  //   - 'free'  → BE confirms available
  //   - 'taken' → BE reports another user already owns this name
  //   - 'error' → network or 5xx; we let the user proceed and rely
  //               on the server-side check at /onboarding/complete
  type NameStatus = "idle" | "check" | "free" | "taken" | "error";
  const [nameStatus, setNameStatus] = useState<NameStatus>("idle");

  useEffect(() => {
    const trimmed = companyName.trim();
    if (trimmed.length === 0) {
      setNameStatus("idle");
      return;
    }
    setNameStatus("check");
    let cancelled = false;
    const handle = setTimeout(() => {
      checkOnboardingCompanyName(trimmed)
        .then((res) => {
          if (cancelled) return;
          setNameStatus(res.available ? "free" : "taken");
        })
        .catch(() => {
          if (cancelled) return;
          setNameStatus("error");
        });
    }, 400);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [companyName]);

  const errors = {
    companyName: !companyName.trim(),
    industry: !industry,
    teamSize: !teamSize,
  };
  const hasError =
    errors.companyName || errors.industry || errors.teamSize;
  // Block Continue while a duplicate is detected or while the check
  // is still in flight (avoids a race where the user clicks Continue
  // 100ms after typing and walks through the wizard before the BE
  // call returns). 'error' falls through so a flaky check endpoint
  // doesn't strand the user — the server-side check at completion
  // catches a genuine duplicate.
  const blockedByNameCheck =
    nameStatus === "taken" || nameStatus === "check";

  const handleContinue = () => {
    if (hasError || blockedByNameCheck) {
      setAttempted(true);
      return;
    }
    // All fields already in context via individual onChanges, so a
    // patchless saveDraft persists exactly what the user sees.
    saveDraft();
    router.push("/setup-profile/step-4");
  };

  return (
    <div className="flex min-h-screen w-full items-center justify-center bg-bg-1 bg-[url('/login-bg.png')] bg-cover bg-center bg-no-repeat px-4 py-8">
      <Card className="w-full max-w-[500px] flex flex-col items-center gap-8 p-[30px] bg-bg-white rounded-md">
        <Image
          src="/full-logo.png"
          alt="WorkenAI"
          width={106}
          height={29}
          priority
        />

        <div className="w-full max-w-[400px] flex flex-col gap-8">
          <div className="flex flex-col gap-2">
            <h1 className="text-[32px] font-bold leading-tight text-text-1 text-center">
              Set up your WorkenAI Identity
            </h1>
            <p className="text-[18px] font-normal leading-snug text-text-2 text-center">
              Configure your organizational profile to customize your
              enterprise AI experience.
            </p>
          </div>

          {/* Selected profile summary (Company) */}
          <div className="flex items-start gap-4 rounded border-[1.5px] border-primary-6 bg-bg-white p-6 text-left">
            <div className="h-10 w-10 shrink-0 rounded bg-bg-1 flex items-center justify-center">
              <Building2 className="h-5 w-5 text-primary-7" strokeWidth={2} />
            </div>
            <div className="flex flex-col gap-1">
              <h3 className="text-base font-bold text-text-1 leading-normal">
                Company Profile
              </h3>
              <p className="text-[13px] font-medium leading-relaxed text-text-3">
                For organizational use by Fortune 500 companies and government
                contractors.
              </p>
            </div>
          </div>

          {/* Form */}
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-1">
              <div className="relative">
                <UserIcon className="absolute left-3.5 top-1/2 -translate-y-1/2 h-5 w-5 text-text-3" />
                <Input
                  placeholder="Company Name"
                  value={companyName}
                  onChange={(e) => update({ companyName: e.target.value })}
                  aria-invalid={
                    (attempted && errors.companyName) ||
                    nameStatus === "taken"
                  }
                  className={`h-11 pl-10 pr-10 text-base rounded-md placeholder:text-text-3 ${
                    nameStatus === "taken"
                      ? "border-danger-5 focus-visible:border-danger-5 focus-visible:ring-danger-5/20"
                      : "border-border-3"
                  }`}
                />
                {/* Right-edge spinner while the debounced check is
                    in flight — subtle hint that we're confirming the
                    name, without blocking interaction. */}
                {nameStatus === "check" && (
                  <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 animate-spin text-text-3" />
                )}
              </div>
              {attempted && errors.companyName ? (
                <p className="text-[12px] text-danger-6">
                  Company name is required.
                </p>
              ) : nameStatus === "taken" ? (
                <p className="text-[12px] text-danger-6">
                  This company already exists. Ask the admin to invite you,
                  or pick a different name.
                </p>
              ) : null}
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
                  <SelectValue placeholder="Industry" />
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
                  Pick an industry.
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
                  <SelectValue placeholder="Team Size" />
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
                  Pick a team size.
                </p>
              )}
            </div>

            <div className="flex justify-between pt-2">
              <Button
                variant="ghost"
                className="h-12 w-[75px] rounded-lg text-text-1"
                onClick={() => router.back()}
              >
                Back
              </Button>
              <Button
                className="h-12 w-[127px] rounded-lg bg-primary-6 hover:bg-primary-7 text-text-white disabled:opacity-50 disabled:cursor-not-allowed"
                onClick={handleContinue}
                disabled={blockedByNameCheck}
                title={
                  nameStatus === "taken"
                    ? "This company already exists — pick a different name or ask for an invite."
                    : nameStatus === "check"
                      ? "Checking company name…"
                      : undefined
                }
              >
                Continue
              </Button>
            </div>
          </div>
        </div>
      </Card>
    </div>
  );
}
