"use client";

import Link from "next/link";
import Image from "next/image";
import { Compass, ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useLanguage } from "@/lib/i18n";

// Global 404 — rendered inside the root layout (so it inherits the fonts,
// theme and i18n provider). Matches the auth pages' centered, branded shell.
export default function NotFound() {
  const { t } = useLanguage();

  return (
    <div className="flex min-h-screen w-full items-center justify-center bg-bg-1 bg-[url('/login-bg.png')] bg-cover bg-center bg-no-repeat px-4 py-8">
      <Card className="flex w-full max-w-[500px] flex-col items-center gap-8 rounded-md border border-border-2 bg-bg-white p-[30px]">
        <Image
          src="/full-logo.png"
          alt="WorkenAI"
          width={128}
          height={17}
          priority
        />

        <div className="flex w-full max-w-[400px] flex-col items-center gap-6 py-6">
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-primary-1">
            <Compass className="h-8 w-8 text-primary-6" strokeWidth={1.5} />
          </div>

          <span className="text-[64px] font-extrabold leading-none text-primary-6">
            404
          </span>

          <div className="flex flex-col items-center gap-2">
            <h1 className="text-center text-[26px] font-bold leading-tight text-text-1">
              {t("notFound.title")}
            </h1>
            <p className="text-center text-[16px] font-normal leading-snug text-text-2">
              {t("notFound.desc")}
            </p>
          </div>

          <Button
            asChild
            className="cursor-pointer bg-primary-6 hover:bg-primary-7"
          >
            <Link href="/">
              <ArrowLeft className="mr-1.5 h-4 w-4" />
              {t("notFound.backHome")}
            </Link>
          </Button>
        </div>
      </Card>
    </div>
  );
}
