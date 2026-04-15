"use client";

import { Suspense, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Lock, LogIn } from "lucide-react";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { resetPassword } from "@/lib/api";

const MIN_PASSWORD_LENGTH = 8;

function ResetPasswordContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get("token");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [validationError, setValidationError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: () => {
      if (!token) throw new Error("Missing reset token");
      return resetPassword(token, password);
    },
    onSuccess: () => {
      toast.success("Password updated. Please sign in.");
      router.push("/login");
    },
    onError: (err: Error) => {
      setValidationError(err.message);
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setValidationError(null);
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

  if (!token) {
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
              Missing reset token
            </CardTitle>
            <CardDescription className="text-lg leading-tight font-normal text-text-2 py-1">
              The link you followed is incomplete. Request a new reset email.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild className="w-full h-14 bg-primary-6 hover:bg-primary-7 text-text-white text-base font-normal rounded-md" size="lg">
              <Link href="/forgot-password">Request a new link</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

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
            Set a new password
          </CardTitle>
          <CardDescription className="text-lg leading-tight font-normal text-text-2 py-1">
            Choose a new password for your WorkenAI account.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit}>
            <div className="relative">
              <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-text-3" />
              <Input
                type="password"
                placeholder="New password (min 8 characters)"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={MIN_PASSWORD_LENGTH}
                className="h-14 pl-9 pr-3.5 text-base rounded-md border-border-3 placeholder:text-text-3"
              />
            </div>
            <div className="relative mt-4">
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
              {mutation.isPending ? "Updating..." : "Update password"}
            </Button>
            <p className="text-sm text-text-2 mt-6">
              {"Remembered it? "}
              <Link
                href="/login"
                className="text-primary-6 hover:text-primary-7 font-medium"
              >
                Back to login
              </Link>
            </p>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen w-full items-center justify-center bg-bg-1" />
      }
    >
      <ResetPasswordContent />
    </Suspense>
  );
}
