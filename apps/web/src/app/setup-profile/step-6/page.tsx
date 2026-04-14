"use client";

import { useRef } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { UploadCloud, FolderClosed, Users, Server, Award } from "lucide-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { completeOnboarding } from "@/lib/api";
import { useOnboarding } from "../layout";

const CATEGORIES: Array<{
  title: string;
  subtitle: string;
  icon: typeof FolderClosed;
}> = [
  { title: "Project Case Studies", subtitle: "Past proposals", icon: FolderClosed },
  { title: "CVs/Resumes", subtitle: "Team profiles", icon: Users },
  { title: "IT Stack Docs", subtitle: "Technical specs", icon: Server },
  { title: "Certificates", subtitle: "Professional creds", icon: Award },
];

export default function SetupProfileStep6Page() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { state, files, setFiles, reset } = useOnboarding();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFiles = (incoming: FileList | null) => {
    if (!incoming) return;
    setFiles(Array.from(incoming));
  };

  const mutation = useMutation({
    mutationFn: async () => {
      if (!state.profileType) {
        throw new Error("Please restart setup from the beginning.");
      }
      if (!state.infraChoice) {
        throw new Error("Please pick an infrastructure option in step 4.");
      }
      if (state.profileType === "company" && !state.companyName?.trim()) {
        throw new Error("Company name is required.");
      }
      if (state.profileType === "personal" && !state.fullName?.trim()) {
        throw new Error("Full name is required.");
      }
      await completeOnboarding(
        {
          profileType: state.profileType,
          fullName: state.fullName,
          companyName: state.companyName,
          industry: state.industry,
          teamSize: state.teamSize,
          infraChoice: state.infraChoice,
          apiKeys: state.apiKeys,
        },
        files,
      );
    },
    onSuccess: () => {
      reset();
      queryClient.invalidateQueries({ queryKey: ["auth", "me"] });
      window.location.href = "/";
    },
    onError: (err: Error) => {
      toast.error(err.message || "Couldn't save your setup. Please try again.");
    },
  });

  return (
    <div className="flex min-h-screen w-full items-center justify-center bg-bg-1 bg-[url('/login-bg.png')] bg-cover bg-center bg-no-repeat px-4 py-8">
      <Card className="w-full max-w-[900px] flex flex-col items-center gap-8 p-[30px] bg-bg-white rounded-md">
        <Image
          src="/full-logo.png"
          alt="WorkenAI"
          width={106}
          height={29}
          priority
        />

        <div className="w-full flex flex-col gap-8">
          <div className="flex flex-col gap-2">
            <h1 className="text-[32px] font-bold leading-tight text-text-1 text-center">
              Initialize your Knowledge Core
            </h1>
            <p className="text-[18px] font-normal leading-snug text-text-2 text-center">
              Upload documents to train your enterprise AI on your internal
              expertise and institutional knowledge.
            </p>
          </div>

          {/* Dropzone */}
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="flex items-center justify-center gap-4 rounded border-[1.5px] border-dashed border-border-3 bg-bg-white p-10 text-left transition-colors hover:border-primary-6"
          >
            <div className="h-16 w-16 shrink-0 rounded-lg bg-bg-1 flex items-center justify-center">
              <UploadCloud className="h-8 w-8 text-primary-7" strokeWidth={2} />
            </div>
            <div className="flex flex-col gap-1 items-start">
              <span className="text-base font-bold text-text-1">
                Drop files here or click to browse
              </span>
              <span className="text-[13px] font-medium text-text-3">
                Supports PDF, DOC, DOCX, TXT (Max 50MB per file)
              </span>
            </div>
            <span className="ml-auto inline-flex h-[42px] items-center rounded bg-primary-7 px-6 text-sm font-medium text-text-white">
              Select Files
            </span>
            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf,.doc,.docx,.txt"
              multiple
              className="hidden"
              onChange={(e) => handleFiles(e.target.files)}
            />
          </button>

          {/* Suggested categories */}
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            {CATEGORIES.map(({ title, subtitle, icon: Icon }) => (
              <div
                key={title}
                className="flex flex-col items-center gap-3 rounded p-4 text-center"
              >
                <div className="h-12 w-12 rounded bg-bg-1 flex items-center justify-center">
                  <Icon className="h-6 w-6 text-primary-7" strokeWidth={2} />
                </div>
                <div className="flex flex-col gap-0.5">
                  <span className="text-sm font-normal text-text-1">
                    {title}
                  </span>
                  <span className="text-[11px] text-text-3">{subtitle}</span>
                </div>
              </div>
            ))}
          </div>

          {/* Upload status */}
          <div className="rounded border border-border-2 bg-bg-1 px-6 py-5 text-center text-[13px] text-text-3">
            {files.length === 0
              ? "No files uploaded yet. Add documents to begin training your AI."
              : `${files.length} file${files.length === 1 ? "" : "s"} selected: ${files.map((f) => f.name).join(", ")}`}
          </div>

          <div className="flex justify-between">
            <Button
              variant="ghost"
              className="h-12 w-[75px] rounded-lg text-text-1"
              onClick={() => router.back()}
              disabled={mutation.isPending}
            >
              Back
            </Button>
            <Button
              className="h-12 w-[175px] rounded-lg bg-primary-6 hover:bg-primary-7 text-text-white"
              onClick={() => mutation.mutate()}
              disabled={mutation.isPending}
            >
              {mutation.isPending ? "Saving..." : "Complete Setup"}
            </Button>
          </div>
        </div>
      </Card>
    </div>
  );
}
