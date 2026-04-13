"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import Image from "next/image";
import Link from "next/link";
import { Mail, Lock, LogIn, User } from "lucide-react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  fetchInviteDetails,
  signupWithPassword,
  type InviteDetails,
} from "@/lib/api";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";
const MIN_PASSWORD_LENGTH = 8;

function RegisterContent() {
  const searchParams = useSearchParams();
  const token = searchParams.get("token");
  const invitedEmail = searchParams.get("email");

  const [name, setName] = useState("");
  const [email, setEmail] = useState(invitedEmail ?? "");
  const [password, setPassword] = useState("");
  const [validationError, setValidationError] = useState<string | null>(null);

  // Pre-fill the invited email if it arrived after the first render.
  useEffect(() => {
    if (invitedEmail && !email) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setEmail(invitedEmail);
    }
  }, [invitedEmail, email]);

  const inviteQuery = useQuery<InviteDetails>({
    queryKey: ["invite", token],
    queryFn: () => fetchInviteDetails(token!),
    enabled: !!token,
    retry: false,
  });

  const mutation = useMutation({
    mutationFn: () =>
      signupWithPassword({
        email: email.trim(),
        password,
        name: name.trim(),
        token: token ?? undefined,
      }),
    onSuccess: (result) => {
      if (result.verified) {
        toast.success(
          inviteQuery.data
            ? `Welcome to ${inviteQuery.data.teamName}!`
            : "Account created",
        );
        window.location.href = "/setup-profile";
      } else {
        window.location.href = `/check-email?email=${encodeURIComponent(result.email)}`;
      }
    },
    onError: (err: Error) => {
      toast.error(err.message);
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setValidationError(null);
    const trimmedName = name.trim();
    const trimmedEmail = email.trim();
    if (!trimmedName) {
      setValidationError("Please enter your name");
      return;
    }
    if (!trimmedEmail) {
      setValidationError("Please enter your email");
      return;
    }
    if (password.length < MIN_PASSWORD_LENGTH) {
      setValidationError(
        `Password must be at least ${MIN_PASSWORD_LENGTH} characters`,
      );
      return;
    }
    mutation.mutate();
  };

  const emailLocked = !!invitedEmail;

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
            Create an Account
          </CardTitle>
          <CardDescription className="text-lg leading-tight font-normal text-text-2 py-1">
            {token && inviteQuery.data
              ? `You're signing up to join ${inviteQuery.data.teamName}`
              : "Enter your details to create a new workspace"}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit}>
            <div className="relative">
              <User className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-text-3" />
              <Input
                type="text"
                placeholder="Full Name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                className="h-14 pl-9 pr-3.5 text-base rounded-md border-border-3 placeholder:text-text-3"
              />
            </div>
            <div className="relative mt-4">
              <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-text-3" />
              <Input
                type="email"
                placeholder="Email Address"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                disabled={emailLocked}
                className="h-14 pl-9 pr-3.5 text-base rounded-md border-border-3 placeholder:text-text-3 disabled:opacity-80"
              />
            </div>
            <div className="relative mt-4">
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
              <LogIn className="h-4 w-4" />
              {mutation.isPending ? "Creating account..." : "Continue"}
            </Button>
          </form>
          <div className="flex items-center gap-2 my-6">
            <div className="flex-1 h-0 border-t border-divider" />
            <span className="text-sm text-text-2">or continue with</span>
            <div className="flex-1 h-0 border-t border-divider" />
          </div>
          <Button
            variant="outline"
            className="w-full gap-2 h-14 text-base font-normal rounded-md border-border-3"
            size="lg"
            onClick={() => {
              if (token) {
                document.cookie = `invite_return_to=/invite?token=${token}; path=/; max-age=600; SameSite=Lax`;
              }
              window.location.href = `${API_URL}/auth/google`;
            }}
          >
            <svg className="h-4 w-4 text-text-1" viewBox="0 0 24 24" fill="currentColor">
              <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" />
              <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
              <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
              <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
            </svg>
            Google
          </Button>
          <p className="text-sm text-text-2 mt-6">
            {"Already have an account? "}
            <Link href="/login" className="text-primary-6 hover:text-primary-7 font-medium">Sign in</Link>
            {" to your workspace"}
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

export default function RegisterPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen w-full items-center justify-center bg-bg-1" />
      }
    >
      <RegisterContent />
    </Suspense>
  );
}
