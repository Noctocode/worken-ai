"use client";

import { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { Mail, Send } from "lucide-react";
import { useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { requestPasswordReset } from "@/lib/api";
import { useLanguage } from "@/lib/i18n";

export default function ForgotPasswordPage() {
  const { t } = useLanguage();
  const [email, setEmail] = useState("");
  const [validationError, setValidationError] = useState<string | null>(null);
  const [submittedEmail, setSubmittedEmail] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: () => requestPasswordReset(email.trim()),
    onSuccess: () => {
      setSubmittedEmail(email.trim());
    },
    onError: (err: Error) => {
      setValidationError(err.message);
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setValidationError(null);
    if (!email.trim()) {
      setValidationError(t("auth.enterEmail"));
      return;
    }
    mutation.mutate();
  };

  return (
    <div className="flex min-h-screen w-full items-center justify-center bg-bg-1 bg-[url('/login-bg.png')] bg-cover bg-center bg-no-repeat px-4 py-8">
      <Card className="w-full max-w-[500px] mx-4 text-center p-8">
        <CardHeader>
          <div className="flex items-center justify-center">
            <Image
              src="/full-logo.png"
              alt="WorkenAI"
              width={128}
              height={17}
              priority
            />
          </div>
          <CardTitle className="text-[32px] font-bold leading-none text-text-1 py-1 mt-3">
            {t("auth.forgotTitle")}
          </CardTitle>
          <CardDescription className="text-lg leading-tight font-normal text-text-2 py-1">
            {t("auth.forgotDesc")}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {submittedEmail ? (
            <div className="flex flex-col gap-4">
              <div className="rounded-md border border-border-3 bg-bg-1 p-4 text-left text-sm">
                <p className="text-text-1 font-medium mb-1">
                  {t("auth.checkInbox")}
                </p>
                <p className="text-text-2">
                  {t("auth.resetLinkSentPrefix")}{" "}
                  <span className="font-medium">{submittedEmail}</span>
                  {t("auth.resetLinkSentSuffix")}
                </p>
              </div>
              <Button asChild className="w-full h-14 bg-primary-6 hover:bg-primary-7 text-text-white text-base font-normal rounded-md" size="lg">
                <Link href="/login">{t("auth.backToLogin")}</Link>
              </Button>
            </div>
          ) : (
            <form onSubmit={handleSubmit}>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-text-3" />
                <Input
                  type="email"
                  placeholder={t("auth.email")}
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  className="h-14 pl-9 pr-3.5 text-base rounded-md border-border-3 placeholder:text-text-3"
                />
              </div>
              {validationError && (
                <p className="mt-3 text-sm text-danger-6 text-left">
                  {validationError}
                </p>
              )}
              <Button
                type="submit"
                disabled={mutation.isPending}
                className="w-full h-14 gap-2 bg-primary-6 hover:bg-primary-7 text-text-white text-base font-normal rounded-md mt-4"
                size="lg"
              >
                <Send className="h-4 w-4" />
                {mutation.isPending ? t("auth.sending") : t("auth.sendResetLink")}
              </Button>
              <p className="text-sm text-text-2 mt-6">
                {t("auth.rememberedIt")}
                <Link
                  href="/login"
                  className="text-primary-6 hover:text-primary-7 font-medium"
                >
                  {t("auth.backToLogin")}
                </Link>
              </p>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
