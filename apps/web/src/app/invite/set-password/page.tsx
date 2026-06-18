"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import Image from "next/image";
import Link from "next/link";
import { Loader2, Lock } from "lucide-react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  AuthApiError,
  fetchInviteDetails,
  signupWithPassword,
  type InviteDetails,
} from "@/lib/api";
import { useLanguage } from "@/lib/i18n";

const MIN_PASSWORD_LENGTH = 8;

type LoadErrorKind =
  | "missing_token"
  | "not_found"
  | "expired"
  | "revoked"
  | "already_accepted"
  | "unknown";

function classifyLoadError(message: string): LoadErrorKind {
  const m = message.toLowerCase();
  if (m.includes("not found")) return "not_found";
  if (m.includes("expired")) return "expired";
  if (m.includes("revoked")) return "revoked";
  if (m.includes("already been accepted")) return "already_accepted";
  return "unknown";
}

function SetPasswordContent() {
  const { t } = useLanguage();
  const searchParams = useSearchParams();
  const token = searchParams.get("token");

  const inviteQuery = useQuery<InviteDetails, Error>({
    queryKey: ["invite", token],
    queryFn: () => fetchInviteDetails(token!),
    enabled: !!token,
    retry: false,
  });

  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [validationError, setValidationError] = useState<string | null>(null);
  const [accountExists, setAccountExists] = useState(false);

  const mutation = useMutation({
    mutationFn: () => {
      if (!inviteQuery.data || !token) {
        throw new Error("Invite not ready");
      }
      const invitedEmail = inviteQuery.data.email;
      // Backend requires `name`; derive a placeholder from the email — the user
      // can edit it from their profile later.
      const name = invitedEmail.split("@")[0] || invitedEmail;
      return signupWithPassword({
        email: invitedEmail,
        password,
        name,
        token,
      });
    },
    onSuccess: (result) => {
      if (result.verified) {
        toast.success(
          inviteQuery.data
            ? `${t("invite.welcomeTo")} ${inviteQuery.data.teamName}!`
            : t("auth.accountCreated"),
        );
        window.location.href = "/setup-profile";
      } else {
        // Shouldn't happen with an invite token (autoVerify is set), but just
        // in case: fall back to the standalone verify-email flow.
        window.location.href = `/check-email?email=${encodeURIComponent(result.email)}`;
      }
    },
    onError: (err: Error) => {
      const message = err.message ?? "Something went wrong";
      if (
        err instanceof AuthApiError &&
        /already registered|already exists/i.test(message)
      ) {
        setAccountExists(true);
        return;
      }
      toast.error(message);
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setValidationError(null);
    setAccountExists(false);
    if (password.length < MIN_PASSWORD_LENGTH) {
      setValidationError(t("auth.passwordMinError"));
      return;
    }
    if (password !== confirmPassword) {
      setValidationError(t("auth.passwordsDontMatch"));
      return;
    }
    mutation.mutate();
  };

  return (
    <div className="flex min-h-screen w-full items-center justify-center bg-bg-1 bg-[url('/login-bg.png')] bg-cover bg-center bg-no-repeat px-4 py-8">
      <Card className="w-full max-w-[500px] flex flex-col items-center gap-8 p-[30px] bg-bg-white border-border-3 rounded-md text-center">
        <Image
          src="/full-logo.png"
          alt="WorkenAI"
          width={128}
          height={17}
          priority
        />

        {!token && <ErrorPanel kind="missing_token" />}

        {token && inviteQuery.isLoading && (
          <div className="flex flex-col items-center gap-3 py-4 self-stretch">
            <Loader2 className="h-8 w-8 animate-spin text-text-3" />
            <p className="text-base text-text-2">{t("invite.loading")}</p>
          </div>
        )}

        {token && inviteQuery.isError && (
          <ErrorPanel kind={classifyLoadError(inviteQuery.error.message)} />
        )}

        {token && inviteQuery.data && (
          <>
            <div className="flex flex-col gap-2 self-stretch">
              <h4 className="text-text-1">{t("invite.setPassword")}</h4>
              <p className="text-[18px] leading-snug font-normal text-text-2">
                {t("invite.joiningPrefix")}{" "}
                <span className="font-semibold text-text-1">
                  &ldquo;{inviteQuery.data.teamName}&rdquo;
                </span>
                {t("invite.choosePassword")}
              </p>
            </div>

            <form onSubmit={handleSubmit} className="self-stretch space-y-4">
              <Input
                type="email"
                value={inviteQuery.data.email}
                disabled
                className="h-14 px-3.5 text-base rounded-md border-border-3 disabled:opacity-80"
              />
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-text-3" />
                <Input
                  type="password"
                  placeholder={t("auth.passwordMinChars")}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  minLength={MIN_PASSWORD_LENGTH}
                  className="h-14 pl-9 pr-3.5 text-base rounded-md border-border-3 placeholder:text-text-3"
                />
              </div>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-text-3" />
                <Input
                  type="password"
                  placeholder={t("auth.confirmPassword")}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  required
                  minLength={MIN_PASSWORD_LENGTH}
                  className="h-14 pl-9 pr-3.5 text-base rounded-md border-border-3 placeholder:text-text-3"
                />
              </div>

              {validationError && (
                <p className="text-sm text-danger-6 text-left">
                  {validationError}
                </p>
              )}

              {accountExists && (
                <div className="rounded-md border border-warning-5 bg-warning-1 p-3 text-left text-sm">
                  <p className="text-text-1 font-medium mb-1">
                    {t("invite.accountExists")}
                  </p>
                  <Link
                    href={`/login?token=${encodeURIComponent(token)}&email=${encodeURIComponent(inviteQuery.data.email)}`}
                    className="text-primary-6 hover:text-primary-7 font-medium"
                  >
                    {t("invite.loginInstead")}
                  </Link>
                </div>
              )}

              <Button
                type="submit"
                disabled={mutation.isPending}
                className="w-full h-[52px] px-6 bg-primary-6 hover:bg-primary-7 text-text-white text-base font-normal rounded-lg"
              >
                {mutation.isPending ? t("invite.creatingAccount") : t("invite.createAndJoin")}
              </Button>

              <p className="text-sm text-text-2">
                {t("invite.alreadyHaveAccount")}
                <Link
                  href={`/login?token=${encodeURIComponent(token)}&email=${encodeURIComponent(inviteQuery.data.email)}`}
                  className="text-primary-6 hover:text-primary-7 font-medium"
                >
                  {t("invite.logIn")}
                </Link>
              </p>
            </form>
          </>
        )}
      </Card>
    </div>
  );
}

function ErrorPanel({ kind }: { kind: LoadErrorKind }) {
  const { t } = useLanguage();
  let title: string;
  let subtitle: string;
  switch (kind) {
    case "missing_token":
      title = t("invite.notFound");
      subtitle = t("invite.missingTokenDesc");
      break;
    case "not_found":
      title = t("invite.notFound");
      subtitle = t("invite.notFoundDesc");
      break;
    case "expired":
      title = t("invite.expired");
      subtitle = t("invite.expiredDesc");
      break;
    case "revoked":
      title = t("invite.noLongerValid");
      subtitle = t("invite.revokedDesc");
      break;
    case "already_accepted":
      title = t("invite.alreadyAccepted");
      subtitle = t("invite.alreadyAcceptedDesc");
      break;
    default:
      title = t("invite.invalid");
      subtitle = t("invite.unknownDesc");
  }

  return (
    <>
      <div className="flex flex-col gap-2 self-stretch">
        <h4 className="text-text-1">{title}</h4>
        <p className="text-[18px] leading-snug font-normal text-text-2">
          {subtitle}
        </p>
      </div>
      <Button
        asChild
        variant="outline"
        className="w-full h-[52px] px-6 border-border-3 text-text-1 text-base font-normal rounded-lg"
      >
        <Link href="/login">{t("invite.backToLogin")}</Link>
      </Button>
    </>
  );
}

export default function SetPasswordPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen w-full items-center justify-center bg-bg-1">
          <Loader2 className="h-8 w-8 animate-spin text-text-3" />
        </div>
      }
    >
      <SetPasswordContent />
    </Suspense>
  );
}
