"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
// TODO: replace lucide placeholders with exported SVGs from Figma frame 4109-14790.
import { UserRound, User as UserIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

export default function SetupProfileStep3Page() {
  const router = useRouter();
  const [fullName, setFullName] = useState("");

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

          {/* Selected profile summary (Private Professional) */}
          <div className="flex items-start gap-4 rounded border-[1.5px] border-primary-6 bg-bg-white p-6 text-left">
            <div className="h-10 w-10 shrink-0 rounded bg-bg-1 flex items-center justify-center">
              <UserRound className="h-5 w-5 text-primary-7" strokeWidth={2} />
            </div>
            <div className="flex flex-col gap-1">
              <h3 className="text-base font-bold text-text-1 leading-normal">
                Private Professional Profile
              </h3>
              <p className="text-[13px] font-medium leading-relaxed text-text-3">
                For individual expert use with personal data and credentials.
              </p>
            </div>
          </div>

          {/* Form */}
          <div className="flex flex-col gap-4">
            <div className="relative">
              <UserIcon className="absolute left-3.5 top-1/2 -translate-y-1/2 h-5 w-5 text-text-3" />
              <Input
                placeholder="Full name"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                className="h-11 pl-10 text-base rounded-md border-border-3 placeholder:text-text-3"
              />
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
