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
            ? `Welcome to ${inviteQuery.data.teamName}!`
            : "Account created",
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
      setValidationError(
        `Password must be at least ${MIN_PASSWORD_LENGTH} characters`,
      );
      return;
    }
    if (password !== confirmPassword) {
      setValidationError("Passwords don't match");
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
          width={106}
          height={29}
          priority
        />

        {!token && <ErrorPanel kind="missing_token" />}

        {token && inviteQuery.isLoading && (
          <div className="flex flex-col items-center gap-3 py-4 self-stretch">
            <Loader2 className="h-8 w-8 animate-spin text-text-3" />
            <p className="text-base text-text-2">Loading invitation…</p>
          </div>
        )}

        {token && inviteQuery.isError && (
          <ErrorPanel kind={classifyLoadError(inviteQuery.error.message)} />
        )}

        {token && inviteQuery.data && (
          <>
            <div className="flex flex-col gap-2 self-stretch">
              <h4 className="text-text-1">Set your password</h4>
              <p className="text-[18px] leading-snug font-normal text-text-2">
                You&apos;re joining{" "}
                <span className="font-semibold text-text-1">
                  &ldquo;{inviteQuery.data.teamName}&rdquo;
                </span>
                . Choose a password to create your account.
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
                  placeholder="Password (min 8 characters)"
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
                  placeholder="Confirm password"
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
                    An account with this email already exists.
                  </p>
                  <Link
                    href={`/login?token=${encodeURIComponent(token)}&email=${encodeURIComponent(inviteQuery.data.email)}`}
                    className="text-primary-6 hover:text-primary-7 font-medium"
                  >
                    Log in instead
                  </Link>
                </div>
              )}

              <Button
                type="submit"
                disabled={mutation.isPending}
                className="w-full h-[52px] px-6 bg-primary-6 hover:bg-primary-7 text-text-white text-base font-normal rounded-lg"
              >
                {mutation.isPending ? "Creating account…" : "Create account & join"}
              </Button>

              <p className="text-sm text-text-2">
                {"Already have an account? "}
                <Link
                  href={`/login?token=${encodeURIComponent(token)}&email=${encodeURIComponent(inviteQuery.data.email)}`}
                  className="text-primary-6 hover:text-primary-7 font-medium"
                >
                  Log in
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
  let title: string;
  let subtitle: string;
  switch (kind) {
    case "missing_token":
      title = "Invitation not found";
      subtitle = "The link is missing a token. Please use the link from your invitation email.";
      break;
    case "not_found":
      title = "Invitation not found";
      subtitle = "The link may be incorrect or incomplete.";
      break;
    case "expired":
      title = "This invitation has expired";
      subtitle = "Please ask the person who invited you to send a new invitation.";
      break;
    case "revoked":
      title = "This invitation is no longer valid";
      subtitle = "The invitation was revoked by the company admin.";
      break;
    case "already_accepted":
      title = "This invitation has already been accepted";
      subtitle = "You can sign in to your account.";
      break;
    default:
      title = "Invalid invitation";
      subtitle = "Something went wrong loading this invitation.";
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
        <Link href="/login">Back to login</Link>
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
