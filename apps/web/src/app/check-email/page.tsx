"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import Image from "next/image";
import { Mail } from "lucide-react";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { Card } from "@/components/ui/card";
import { resendVerificationEmail } from "@/lib/api";

function CheckEmailContent() {
  const searchParams = useSearchParams();
  const email = searchParams.get("email");

  const mutation = useMutation({
    mutationFn: async () => {
      if (!email) throw new Error("Missing email");
      await resendVerificationEmail(email);
    },
    onSuccess: () => {
      toast.success("Verification email sent. Please check your inbox.");
    },
    onError: () => {
      toast.error("Couldn't resend right now. Please try again.");
    },
  });

  return (
    <div className="flex min-h-screen w-full items-center justify-center bg-bg-1 bg-[url('/login-bg.png')] bg-cover bg-center bg-no-repeat px-4 py-8">
      <Card className="w-full max-w-[500px] flex flex-col items-center gap-8 p-[30px] bg-bg-white border border-border-2 rounded-md">
        <Image
          src="/full-logo.png"
          alt="WorkenAI"
          width={106}
          height={29}
          priority
        />

        <div className="w-full max-w-[400px] flex flex-col gap-8 py-6">
          <div className="flex flex-col items-center gap-2">
            <Mail className="h-[52px] w-[52px] text-primary-6" strokeWidth={1.5} />
            <h1 className="text-[32px] font-bold leading-tight text-text-1 text-center">
              We sent you a confirmation email.
            </h1>
            <p className="text-[18px] font-normal leading-snug text-text-2 text-center">
              Please check your inbox to continue
            </p>
          </div>

          {email && (
            <p className="text-sm text-text-2 text-center">
              Didn&apos;t receive it?{" "}
              <button
                type="button"
                onClick={() => mutation.mutate()}
                disabled={mutation.isPending}
                className="text-primary-6 hover:text-primary-7 font-medium disabled:opacity-60"
              >
                {mutation.isPending ? "Resending…" : "Resend email"}
              </button>
            </p>
          )}
        </div>
      </Card>
    </div>
  );
}

export default function CheckEmailPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen w-full items-center justify-center bg-bg-1" />
      }
    >
      <CheckEmailContent />
    </Suspense>
  );
}
