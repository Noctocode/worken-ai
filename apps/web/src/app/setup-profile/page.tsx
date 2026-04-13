"use client";

import { useEffect } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { Building2, UserRound } from "lucide-react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { Card } from "@/components/ui/card";
import {
  fetchCurrentUser,
  setProfileType,
  type User,
} from "@/lib/api";

type ProfileType = "company" | "personal";

const OPTIONS: Array<{
  type: ProfileType;
  title: string;
  description: string;
  icon: typeof Building2;
}> = [
  {
    type: "company",
    title: "Company Profile",
    description:
      "For organizational use by Fortune 500 companies and government contractors.",
    icon: Building2,
  },
  {
    type: "personal",
    title: "Private Professional Profile",
    description:
      "For individual expert use with personal data and credentials.",
    icon: UserRound,
  },
];

export default function SetupProfilePage() {
  const router = useRouter();

  const userQuery = useQuery<User>({
    queryKey: ["auth", "me"],
    queryFn: fetchCurrentUser,
  });

  // If the user has already picked a profile type, skip this screen.
  useEffect(() => {
    if (userQuery.data?.profileType) {
      router.replace("/");
    }
  }, [userQuery.data?.profileType, router]);

  const mutation = useMutation({
    mutationFn: (type: ProfileType) => setProfileType(type),
    onSuccess: () => {
      window.location.href = "/";
    },
    onError: () => {
      toast.error("Couldn't save your choice. Please try again.");
    },
  });

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

          <div className="flex flex-col gap-2.5">
            {OPTIONS.map(({ type, title, description, icon: Icon }) => (
              <button
                key={type}
                type="button"
                onClick={() => mutation.mutate(type)}
                disabled={mutation.isPending}
                className="flex items-start gap-4 rounded border border-border-2 bg-bg-white p-6 text-left transition-colors hover:border-primary-6 disabled:opacity-60 disabled:cursor-not-allowed"
              >
                <div className="h-10 w-10 shrink-0 rounded bg-bg-1 flex items-center justify-center">
                  <Icon className="h-5 w-5 text-primary-7" strokeWidth={2} />
                </div>
                <div className="flex flex-col gap-1">
                  <h3 className="text-base font-bold text-text-1 leading-normal">
                    {title}
                  </h3>
                  <p className="text-[13px] font-medium leading-relaxed text-text-3">
                    {description}
                  </p>
                </div>
              </button>
            ))}
          </div>
        </div>
      </Card>
    </div>
  );
}
