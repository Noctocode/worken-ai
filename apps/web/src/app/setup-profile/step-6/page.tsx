"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Image from "next/image";
import {
  UploadCloud,
  FolderClosed,
  Users,
  Server,
  Award,
  FileText,
  X,
  Sparkles,
  Shield,
  CheckCircle2,
  AlertTriangle,
  Loader2,
  Lock,
} from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  completeOnboarding,
  getOnboardingIngestionStatus,
  type IngestionStatusResponse,
  type KnowledgeFileVisibility,
} from "@/lib/api";
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

/**
 * Phases of the step-6 submit flow:
 *  - `idle`     — user is choosing files, primary CTA visible
 *  - `training` — onboarding API succeeded, ingestion is running in
 *                 the background, FE is polling /ingestion-status
 *  - `done`     — ingestion finished (or had nothing to ingest); we
 *                 redirect on this transition
 */
type SubmitPhase = "idle" | "training" | "done";

export default function SetupProfileStep6Page() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const { state, files, setFiles, reset } = useOnboarding();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [phase, setPhase] = useState<SubmitPhase>("idle");
  // Visibility for this onboarding batch. Only meaningful for the
  // company branch — personal uploads are owner-only via scope. Held
  // locally (not in the onboarding draft) because step-6 is the
  // final step; if the user reloads, they restart this step anyway.
  const [knowledgeVisibility, setKnowledgeVisibility] =
    useState<KnowledgeFileVisibility>("all");
  const filesAtSubmitRef = useRef(0);

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
      filesAtSubmitRef.current = files.length;
      await completeOnboarding(
        {
          profileType: state.profileType,
          fullName: state.fullName,
          companyName: state.companyName,
          industry: state.industry,
          teamSize: state.teamSize,
          infraChoice: state.infraChoice,
          apiKeys: state.apiKeys,
          // Only meaningful for company branch — BE forces 'all' for
          // personal profile anyway, but we mirror that here so the
          // payload stays clean.
          knowledgeVisibility:
            state.profileType === "company" ? knowledgeVisibility : "all",
        },
        files,
      );
    },
    onSuccess: () => {
      // Auth side-effects fire immediately so the dashboard the user
      // lands on later sees the completed onboarding state.
      queryClient.invalidateQueries({ queryKey: ["auth", "me"] });
      if (filesAtSubmitRef.current === 0) {
        // No files = no ingestion work. Skip the progress UI and
        // redirect right away so the path stays as fast as it was.
        finishAndRedirect();
      } else {
        // Switch to the "Training your AI…" screen; the polling query
        // below transitions us to `done` once ingestion finishes.
        setPhase("training");
      }
    },
    onError: (err: Error) => {
      toast.error(err.message || "Couldn't save your setup. Please try again.");
    },
  });

  const finishAndRedirect = () => {
    reset();
    // Honour ?next= when present — set by the BE Google callback
    // when the user signed in to accept an invite mid-flow. Has to
    // be a same-origin path; reject anything else as a redirect
    // hardening guard.
    const next = searchParams.get("next");
    const target = next && next.startsWith("/") ? next : "/";
    window.location.href = target;
  };

  // Poll ingestion status only while the user is on the training
  // screen. `refetchInterval` returns false on terminal state to
  // stop hammering the API.
  const ingestionQuery = useQuery<IngestionStatusResponse>({
    queryKey: ["onboarding", "ingestion-status"],
    queryFn: getOnboardingIngestionStatus,
    enabled: phase === "training",
    refetchInterval: (query) =>
      query.state.data && !query.state.data.inProgress ? false : 1500,
  });

  // Two-phase transition so the "Your AI is ready" copy actually
  // gets a chance to render before we navigate away.
  //
  // Pass 1: flip phase training → done as soon as the poll reports
  //   inProgress=false. No timer scheduled here.
  // Pass 2: once phase is `done`, schedule the redirect. The
  //   previous single-effect version returned the setTimeout's
  //   cleanup, which React then ran the moment `phase` changed —
  //   clearing the timer right after we set it and leaving the
  //   user stranded on "Your AI is ready" with no redirect.
  useEffect(() => {
    if (phase !== "training") return;
    const data = ingestionQuery.data;
    if (data && !data.inProgress) {
      setPhase("done");
    }
  }, [phase, ingestionQuery.data]);

  useEffect(() => {
    if (phase !== "done") return;
    const t = setTimeout(finishAndRedirect, 800);
    return () => clearTimeout(t);
  }, [phase]); // eslint-disable-line react-hooks/exhaustive-deps

  if (phase === "training" || phase === "done") {
    const data = ingestionQuery.data;
    const total = data?.total ?? filesAtSubmitRef.current;
    const completed = (data?.done ?? 0) + (data?.failed ?? 0);
    const pct = total > 0 ? Math.round((completed / total) * 100) : 0;
    const allDone = phase === "done";
    return (
      <div className="flex min-h-screen w-full items-center justify-center bg-bg-1 bg-[url('/login-bg.png')] bg-cover bg-center bg-no-repeat px-4 py-8">
        <Card className="w-full max-w-[640px] flex flex-col items-center gap-8 p-[40px] bg-bg-white rounded-md">
          <Image
            src="/full-logo.png"
            alt="WorkenAI"
            width={106}
            height={29}
            priority
          />

          <div className="flex h-20 w-20 items-center justify-center rounded-full bg-primary-1/40">
            {allDone ? (
              <CheckCircle2
                className="h-10 w-10 text-primary-7"
                strokeWidth={2}
              />
            ) : (
              <Sparkles
                className="h-10 w-10 animate-pulse text-primary-7"
                strokeWidth={2}
              />
            )}
          </div>

          <div className="flex flex-col gap-2 text-center">
            <h1 className="text-[28px] font-bold leading-tight text-text-1">
              {allDone ? "Your AI is ready" : "Training your AI…"}
            </h1>
            <p className="text-[15px] font-normal leading-snug text-text-2">
              {allDone
                ? "Knowledge Core is initialized. Redirecting to your workspace."
                : "We're chunking and embedding your uploads so the assistant can draw on them. This usually takes under a minute."}
            </p>
          </div>

          <div className="w-full flex flex-col gap-3">
            <div className="flex items-center justify-between text-[13px] font-medium text-text-2">
              <span>
                {completed} of {total} document{total === 1 ? "" : "s"}
              </span>
              <span>{pct}%</span>
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-bg-1">
              <div
                className="h-full rounded-full bg-primary-7 transition-all duration-500"
                style={{ width: `${pct}%` }}
              />
            </div>
          </div>

          {data && data.documents.length > 0 ? (
            <ul className="w-full flex flex-col gap-2 max-h-[280px] overflow-y-auto">
              {data.documents.map((doc) => (
                <li
                  key={doc.id}
                  className="flex items-center gap-3 rounded border border-border-2 bg-bg-white px-4 py-2.5"
                >
                  {doc.status === "done" ? (
                    <CheckCircle2
                      className="h-4 w-4 shrink-0 text-primary-7"
                      strokeWidth={2}
                    />
                  ) : doc.status === "failed" ? (
                    <AlertTriangle
                      className="h-4 w-4 shrink-0 text-red-600"
                      strokeWidth={2}
                    />
                  ) : (
                    <Loader2
                      className="h-4 w-4 shrink-0 animate-spin text-text-3"
                      strokeWidth={2}
                    />
                  )}
                  <span className="flex-1 truncate text-sm text-text-1">
                    {doc.filename}
                  </span>
                  <span className="text-[11px] uppercase tracking-wide text-text-3">
                    {doc.status === "done"
                      ? "Trained"
                      : doc.status === "failed"
                        ? "Skipped"
                        : doc.status === "processing"
                          ? "Processing"
                          : "Queued"}
                  </span>
                </li>
              ))}
            </ul>
          ) : null}

          {/* Escape hatch in case ingestion stalls — the user is
              already onboarded, so we can let them through manually
              and the dashboard banner will surface remaining work. */}
          {!allDone ? (
            <button
              type="button"
              onClick={finishAndRedirect}
              className="text-[13px] font-medium text-text-3 underline-offset-2 hover:text-text-1 hover:underline"
            >
              Skip and continue to dashboard
            </button>
          ) : null}
        </Card>
      </div>
    );
  }

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

          {/* Visibility banner — surfacing the difference between
              personal-account uploads (private) and company-account
              uploads (org-wide) so the user isn't surprised when an
              invited teammate later pulls one of these docs into a
              chat. Only renders once profileType is known so we don't
              flash the wrong copy on hydration. */}
          {state.profileType === "company" ? (
            <div className="flex flex-col gap-3">
              <div className="flex items-start gap-3 rounded border border-primary-2 bg-primary-1/40 px-4 py-3">
                <Users
                  className="h-5 w-5 shrink-0 text-primary-7 mt-0.5"
                  strokeWidth={2}
                />
                <p className="text-[13px] leading-relaxed text-text-2">
                  <span className="font-semibold text-text-1">
                    These files will be shared with your whole company workspace.
                  </span>{" "}
                  Anyone you invite can pull them into chat as context. Avoid
                  uploading personal documents here — you can add private files
                  later from Knowledge Core.
                </p>
              </div>

              {/* Admin-only second visibility layer. The user IS the
                  company admin at this point (they're completing the
                  onboarding that creates the company), so the toggle
                  is unconditionally rendered for the company branch.
                  Defaults to 'all'; can be flipped per-file from
                  Knowledge Core later. */}
              <div className="flex flex-col gap-1.5 rounded border border-border-2 bg-bg-white px-4 py-3">
                <label className="text-[13px] font-semibold text-text-1">
                  Who can use these documents?
                </label>
                <Select
                  value={knowledgeVisibility}
                  onValueChange={(v) =>
                    setKnowledgeVisibility(v as KnowledgeFileVisibility)
                  }
                >
                  <SelectTrigger className="h-10 w-full cursor-pointer">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">
                      <span className="inline-flex items-center gap-2">
                        <Users className="h-3.5 w-3.5" />
                        Everyone in the company
                      </span>
                    </SelectItem>
                    <SelectItem value="admins">
                      <span className="inline-flex items-center gap-2">
                        <Shield className="h-3.5 w-3.5" />
                        Admins only
                      </span>
                    </SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-[11px] text-text-3">
                  {knowledgeVisibility === "admins"
                    ? "Only admins will see these in chat / arena. You can change this per-file in Knowledge Core later."
                    : "All company users will see these in chat / arena. You can restrict any file to admins later in Knowledge Core."}
                </p>
              </div>
            </div>
          ) : state.profileType === "personal" ? (
            <div className="flex items-start gap-3 rounded border border-border-2 bg-bg-1/60 px-4 py-3">
              <Lock
                className="h-5 w-5 shrink-0 text-text-3 mt-0.5"
                strokeWidth={2}
              />
              <p className="text-[13px] leading-relaxed text-text-2">
                <span className="font-semibold text-text-1">
                  These files stay private to your account.
                </span>{" "}
                Only you will see them in chat.
              </p>
            </div>
          ) : null}

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
