"use client";

import { useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Image from "next/image";
import { UploadCloud, FolderClosed, Users, Server, Award, FileText, X } from "lucide-react";
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

const ACCEPTED_EXTENSIONS = [".pdf", ".doc", ".docx", ".txt"];

function hasAllowedExtension(name: string) {
  const lower = name.toLowerCase();
  return ACCEPTED_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

export default function SetupProfileStep6Page() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const { state, files, setFiles, reset } = useOnboarding();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);

  const handleFiles = (incoming: FileList | File[] | null) => {
    if (!incoming || incoming.length === 0) return;
    // Append, but dedupe on name+size so picking the same file twice
    // doesn't create duplicates. Also filter to the same extensions the
    // backend whitelist accepts so we fail fast in the UI.
    const existingKeys = new Set(files.map((f) => `${f.name}:${f.size}`));
    const arr = Array.from(incoming);
    const rejected = arr.filter((f) => !hasAllowedExtension(f.name));
    const additions = arr
      .filter((f) => hasAllowedExtension(f.name))
      .filter((f) => !existingKeys.has(`${f.name}:${f.size}`));
    if (rejected.length > 0) {
      toast.error(
        `Unsupported file type: ${rejected.map((f) => f.name).join(", ")}. Allowed: PDF, DOC, DOCX, TXT.`,
      );
    }
    if (additions.length > 0) setFiles([...files, ...additions]);
    // Clear the input so selecting the same file again after a remove works.
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    if (!isDragging) setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
    handleFiles(e.dataTransfer.files);
  };

  const removeFile = (index: number) => {
    setFiles(files.filter((_, i) => i !== index));
  };

  const formatBytes = (n: number) => {
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    return `${(n / (1024 * 1024)).toFixed(1)} MB`;
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
      // Honour ?next= when present — set by the BE Google callback
      // when the user signed in to accept an invite mid-flow. Has to
      // be a same-origin path; reject anything else as a redirect
      // hardening guard.
      const next = searchParams.get("next");
      const target = next && next.startsWith("/") ? next : "/";
      window.location.href = target;
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
          <div
            role="button"
            tabIndex={0}
            onClick={() => fileInputRef.current?.click()}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                fileInputRef.current?.click();
              }
            }}
            onDragOver={handleDragOver}
            onDragEnter={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            className={`flex cursor-pointer items-center justify-center gap-4 rounded border-[1.5px] border-dashed p-10 text-left transition-colors ${
              isDragging
                ? "border-primary-6 bg-primary-1/40"
                : "border-border-3 bg-bg-white hover:border-primary-6"
            }`}
          >
            <div className="pointer-events-none flex h-16 w-16 shrink-0 items-center justify-center rounded-lg bg-bg-1">
              <UploadCloud className="h-8 w-8 text-primary-7" strokeWidth={2} />
            </div>
            <div className="pointer-events-none flex flex-col items-start gap-1">
              <span className="text-base font-bold text-text-1">
                Drop files here or click to browse
              </span>
              <span className="text-[13px] font-medium text-text-3">
                Supports PDF, DOC, DOCX, TXT (Max 50MB per file)
              </span>
            </div>
            <span className="pointer-events-none ml-auto inline-flex h-[42px] items-center rounded bg-primary-7 px-6 text-sm font-medium text-text-white">
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
          </div>

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

          {/* Upload status / selected files */}
          {files.length === 0 ? (
            <div className="rounded border border-border-2 bg-bg-1 px-6 py-5 text-center text-[13px] text-text-3">
              No files uploaded yet — this step is optional. You can finish
              setup now and add documents later from Knowledge Core.
            </div>
          ) : (
            <ul className="flex flex-col gap-2">
              {files.map((f, i) => (
                <li
                  key={`${f.name}-${f.size}-${i}`}
                  className="flex items-center gap-3 rounded border border-border-2 bg-bg-white px-4 py-3"
                >
                  <FileText className="h-5 w-5 shrink-0 text-primary-7" strokeWidth={2} />
                  <div className="flex flex-1 flex-col overflow-hidden">
                    <span className="truncate text-sm font-medium text-text-1">
                      {f.name}
                    </span>
                    <span className="text-xs text-text-3">
                      {formatBytes(f.size)}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => removeFile(i)}
                    title="Remove file"
                    className="rounded-md p-1.5 text-text-3 transition-colors hover:bg-bg-1 hover:text-text-1"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </li>
              ))}
            </ul>
          )}

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
              className="h-12 w-[200px] rounded-lg bg-primary-6 hover:bg-primary-7 text-text-white"
              onClick={() => mutation.mutate()}
              disabled={mutation.isPending}
            >
              {mutation.isPending
                ? "Saving..."
                : files.length === 0
                  ? "Skip & Finish Setup"
                  : "Complete Setup"}
            </Button>
          </div>
        </div>
      </Card>
    </div>
  );
}
