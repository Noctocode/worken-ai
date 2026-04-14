"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
// TODO: replace lucide placeholders with exported SVGs from Figma frame 4108-13813.
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
  const [companyName, setCompanyName] = useState("");
  const [industry, setIndustry] = useState("");
  const [teamSize, setTeamSize] = useState("");

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
            <div className="relative">
              <UserIcon className="absolute left-3.5 top-1/2 -translate-y-1/2 h-5 w-5 text-text-3" />
              <Input
                placeholder="Company Name"
                value={companyName}
                onChange={(e) => setCompanyName(e.target.value)}
                className="h-11 pl-10 text-base rounded-md border-border-3 placeholder:text-text-3"
              />
            </div>
            <Select value={industry} onValueChange={setIndustry}>
              <SelectTrigger className="h-11 w-full rounded-md border-border-2 text-base">
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
            <Select value={teamSize} onValueChange={setTeamSize}>
              <SelectTrigger className="h-11 w-full rounded-md border-border-2 text-base">
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

            <div className="flex justify-between pt-2">
              <Button
                variant="ghost"
                className="h-12 w-[75px] rounded-lg text-text-1"
                onClick={() => router.back()}
              >
                Back
              </Button>
              <Button
                className="h-12 w-[127px] rounded-lg bg-primary-6 hover:bg-primary-7 text-text-white"
                onClick={() => router.push("/setup-profile/step-4")}
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
