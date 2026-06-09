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
  abortOnboarding,
  completeOnboarding,
  getOnboardingIngestionStatus,
  type IngestionStatusResponse,
  type KnowledgeFileVisibility,
} from "@/lib/api";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useOnboarding } from "../layout";
import { OnboardingExit } from "../onboarding-exit";
import { useLanguage } from "@/lib/i18n";


const ACCEPTED_EXTENSIONS = [".pdf", ".docx", ".txt"];

function hasAllowedExtension(name: string) {
  const lower = name.toLowerCase();
  return ACCEPTED_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

/**
 * Phases of the step-6 submit flow:
 *  - `idle`      — user is choosing files, primary CTA visible
 *  - `preparing` — onboarding API succeeded, ingestion (chunking +
 *                  embedding into the RAG index) is running in the
 *                  background, FE is polling /ingestion-status
 *  - `done`      — ingestion finished (or had nothing to ingest);
 *                  we redirect on this transition
 */
type SubmitPhase = "idle" | "preparing" | "done";

export default function SetupProfileStep6Page() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const { state, files, setFiles, reset } = useOnboarding();
  const { t } = useLanguage();

  const CATEGORIES: Array<{
    title: string;
    subtitle: string;
    icon: typeof FolderClosed;
  }> = [
    { title: t("onboarding.step6.cat.caseStudies"), subtitle: t("onboarding.step6.cat.caseStudiesSub"), icon: FolderClosed },
    { title: t("onboarding.step6.cat.cvs"), subtitle: t("onboarding.step6.cat.cvsSub"), icon: Users },
    { title: t("onboarding.step6.cat.itStack"), subtitle: t("onboarding.step6.cat.itStackSub"), icon: Server },
    { title: t("onboarding.step6.cat.certs"), subtitle: t("onboarding.step6.cat.certsSub"), icon: Award },
  ];
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [phase, setPhase] = useState<SubmitPhase>("idle");
  // Visibility for this onboarding batch. Only meaningful for the
  // company branch — personal uploads are owner-only via scope. Held
  // locally (not in the onboarding draft) because step-6 is the
  // final step; if the user reloads, they restart this step anyway.
  const [knowledgeVisibility, setKnowledgeVisibility] =
    useState<KnowledgeFileVisibility>("all");
  // The file count we snapshotted at submit time, used as the
  // fallback denominator for the progress bar before the server's
  // ingestion-status response lands. Lives in state (not a ref)
  // because it's read during render — React 19's react-hooks/refs
  // rule correctly flags ref.current accesses in the render body.
  const [filesAtSubmit, setFilesAtSubmit] = useState(0);

  // Surfaces a recovery dialog when `/onboarding/complete` fails so
  // the user has a clear path out: retry the same submit, or hard-
  // reset (deletes their account, frees the email). Without this,
  // a 500 just showed a toast and stranded the user in step 6 with
  // no obvious next move.
  const [failOpen, setFailOpen] = useState(false);
  const [failMessage, setFailMessage] = useState<string>("");
  const [abortingAccount, setAbortingAccount] = useState(false);

  // Elapsed time on the "Setting up your AI…" polling screen. After
  // 60s we surface a "Continue anyway" CTA so a hung ingestion
  // worker can't strand the user indefinitely — they can land on
  // the dashboard and retry failed files from Knowledge Core later.
  const [preparingElapsedSec, setPreparingElapsedSec] = useState(0);

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
        `Unsupported file type: ${rejected.map((f) => f.name).join(", ")}. Allowed: PDF, DOCX, TXT.`,
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
      // Capture the snapshot count in a local — onSuccess gets it via
      // the mutation's return value (synchronous, race-free), while
      // setFilesAtSubmit feeds the render-time progress denominator.
      // Reading `filesAtSubmit` state in onSuccess would race with the
      // setState here because state updates don't apply until the next
      // render, and onSuccess fires synchronously after mutationFn
      // resolves.
      const submittedCount = files.length;
      setFilesAtSubmit(submittedCount);
      await completeOnboarding(
        {
          profileType: state.profileType,
          fullName: state.fullName,
          companyName: state.companyName,
          industry: state.industry,
          teamSize: state.teamSize,
          infraChoice: state.infraChoice,
          apiKeys: state.apiKeys,
          // Azure-only companion to apiKeys.azure (endpoint /
          // api-version / deployments). The BE drops the azure key if
          // this is incomplete, so chat never routes to a half-set-up
          // resource.
          azureConfig: state.azureConfig,
          // Only meaningful for company branch — BE forces 'all' for
          // personal profile anyway, but we mirror that here so the
          // payload stays clean.
          knowledgeVisibility:
            state.profileType === "company" ? knowledgeVisibility : "all",
        },
        files,
      );
      return submittedCount;
    },
    onSuccess: (submittedCount) => {
      // Auth side-effects fire immediately so the dashboard the user
      // lands on later sees the completed onboarding state.
      queryClient.invalidateQueries({ queryKey: ["auth", "me"] });
      if (submittedCount === 0) {
        // No files = no ingestion work. Skip the progress UI and
        // redirect right away so the path stays as fast as it was.
        finishAndRedirect();
      } else {
        // Switch to the "Setting up your AI…" screen; the polling
        // query below transitions us to `done` once ingestion
        // finishes.
        setPhase("preparing");
      }
    },
    onError: (err: Error) => {
      // Show both a transient toast (for context) AND a recovery
      // dialog that exposes the only two sensible next moves: retry
      // the same submit, or hard-reset by deleting the account.
      const msg = err.message || "Couldn't save your setup. Please try again.";
      toast.error(msg);
      setFailMessage(msg);
      setFailOpen(true);
    },
  });

  const onStartOver = async () => {
    if (abortingAccount) return;
    setAbortingAccount(true);
    try {
      await abortOnboarding();
      toast.success(
        "Account deleted. You can register again with the same email.",
      );
      window.location.href = "/register";
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(msg || "Couldn't delete your account. Try again.");
      setAbortingAccount(false);
    }
  };

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

  // Poll ingestion status only while the user is on the preparing
  // screen. `refetchInterval` returns false on terminal state to
  // stop hammering the API.
  const ingestionQuery = useQuery<IngestionStatusResponse>({
    queryKey: ["onboarding", "ingestion-status"],
    queryFn: getOnboardingIngestionStatus,
    enabled: phase === "preparing",
    refetchInterval: (query) =>
      query.state.data && !query.state.data.inProgress ? false : 1500,
  });

  // Two-phase transition so the "Your AI is ready" copy actually
  // gets a chance to render before we navigate away.
  //
  // Pass 1: flip phase preparing → done as soon as the poll reports
  //   inProgress=false. No timer scheduled here.
  // Pass 2: once phase is `done`, schedule the redirect. The
  //   previous single-effect version returned the setTimeout's
  //   cleanup, which React then ran the moment `phase` changed —
  //   clearing the timer right after we set it and leaving the
  //   user stranded on "Your AI is ready" with no redirect.
  useEffect(() => {
    if (phase !== "preparing") return;
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

  // Tick a 1-second elapsed counter while we wait on ingestion so
  // the "Continue anyway" escape after 60s becomes visible without
  // needing the server to send anything. Reset whenever we leave
  // the preparing phase so a retry starts the timer fresh.
  useEffect(() => {
    if (phase !== "preparing") {
      setPreparingElapsedSec(0);
      return;
    }
    const id = window.setInterval(() => {
      setPreparingElapsedSec((s) => s + 1);
    }, 1000);
    return () => window.clearInterval(id);
  }, [phase]);

  if (phase === "preparing" || phase === "done") {
    const data = ingestionQuery.data;
    const total = data?.total ?? filesAtSubmit;
    const completed = (data?.done ?? 0) + (data?.failed ?? 0);
    const pct = total > 0 ? Math.round((completed / total) * 100) : 0;
    const allDone = phase === "done";
    return (
      <div className="flex min-h-screen w-full flex-col items-center justify-center gap-2.5 bg-bg-1 bg-[url('/login-bg.png')] bg-cover bg-center bg-no-repeat px-4 py-8">
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
              {allDone ? t("onboarding.step6.done.title") : t("onboarding.step6.preparing.title")}
            </h1>
            <p className="text-[15px] font-normal leading-snug text-text-2">
              {allDone
                ? t("onboarding.step6.done.subtitle")
                : t("onboarding.step6.preparing.subtitle")}
            </p>
          </div>

          <div className="w-full flex flex-col gap-3">
            <div className="flex items-center justify-between text-[13px] font-medium text-text-2">
              <span>
                {completed} {t("onboarding.step6.doc.of")} {total}{" "}
                {total === 1
                  ? t("onboarding.step6.doc.singular")
                  : t("onboarding.step6.doc.plural")}
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
                      ? t("onboarding.step6.doc.added")
                      : doc.status === "failed"
                        ? t("onboarding.step6.doc.skipped")
                        : doc.status === "processing"
                          ? t("onboarding.step6.doc.adding")
                          : t("onboarding.step6.doc.queued")}
                  </span>
                </li>
              ))}
            </ul>
          ) : null}

          {/* Escape hatch in case ingestion stalls — the user is
              already onboarded, so we can let them through manually
              and the dashboard banner will surface remaining work.
              We surface this as a subtle link by default, then
              promote to a prominent warning + primary CTA after 60s
              so a hung ingestion worker can't trap a user staring
              at a stalled progress bar. */}
          {!allDone && preparingElapsedSec < 60 ? (
            <button
              type="button"
              onClick={finishAndRedirect}
              className="text-[13px] font-medium text-text-3 underline-offset-2 hover:text-text-1 hover:underline"
            >
              {t("onboarding.step6.skip")}
            </button>
          ) : null}
          {!allDone && preparingElapsedSec >= 60 ? (
            <div className="w-full flex flex-col gap-3 rounded border border-warning-3 bg-warning-1/40 p-4 text-left">
              <div className="flex items-start gap-3">
                <AlertTriangle
                  className="h-5 w-5 shrink-0 text-warning-7"
                  strokeWidth={2}
                />
                <div className="flex flex-col gap-1">
                  <p className="text-[14px] font-semibold text-text-1">
                    {t("onboarding.step6.timeout.title")}
                  </p>
                  <p className="text-[13px] font-normal text-text-2">
                    {t("onboarding.step6.timeout.body")}
                  </p>
                </div>
              </div>
              <Button
                onClick={finishAndRedirect}
                className="self-start bg-primary-6 hover:bg-primary-7 text-white"
              >
                {t("onboarding.step6.timeout.cta")}
              </Button>
            </div>
          ) : null}
        </Card>
        {/* Cancel/delete here would 400 — the BE has already stamped
            onboardingCompletedAt by the time we reach this screen.
            Sign out stays available; the rest of the escape hatches
            ("Skip and continue", "Continue anyway") cover the user
            if ingestion stalls. */}
        <OnboardingExit allowCancel={false} />
      </div>
    );
  }

  return (
    <div className="flex min-h-screen w-full flex-col items-center justify-center gap-2.5 bg-bg-1 bg-[url('/login-bg.png')] bg-cover bg-center bg-no-repeat px-4 py-8">
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
              {t("onboarding.step6.title")}
            </h1>
            <p className="text-[18px] font-normal leading-snug text-text-2 text-center">
              {t("onboarding.step6.subtitle")}
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
                    {t("onboarding.step6.companyBannerBold")}
                  </span>{" "}
                  {t("onboarding.step6.companyBannerText")}
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
                  {t("onboarding.step6.visibilityLabel")}
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
                        {t("onboarding.step6.visibilityAll")}
                      </span>
                    </SelectItem>
                    <SelectItem value="admins">
                      <span className="inline-flex items-center gap-2">
                        <Shield className="h-3.5 w-3.5" />
                        {t("onboarding.step6.visibilityAdmins")}
                      </span>
                    </SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-[11px] text-text-3">
                  {knowledgeVisibility === "admins"
                    ? t("onboarding.step6.visibilityAdminsDesc")
                    : t("onboarding.step6.visibilityAllDesc")}
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
                  {t("onboarding.step6.personalBannerBold")}
                </span>{" "}
                {t("onboarding.step6.personalBannerText")}
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
                {t("onboarding.step6.dropzoneTitle")}
              </span>
              <span className="text-[13px] font-medium text-text-3">
                {t("onboarding.step6.dropzoneSubtitle")}
              </span>
            </div>
            <span className="pointer-events-none ml-auto inline-flex h-[42px] items-center rounded bg-primary-7 px-6 text-sm font-medium text-text-white">
              {t("onboarding.step6.selectFiles")}
            </span>
            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf,.docx,.txt"
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
              {t("onboarding.step6.noFiles")}
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
                    title={t("setupSix.removeFile")}
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
              {t("common.back")}
            </Button>
            <Button
              className="h-12 min-w-[200px] rounded-lg px-8 bg-primary-6 hover:bg-primary-7 text-text-white"
              onClick={() => mutation.mutate()}
              disabled={mutation.isPending}
            >
              {mutation.isPending
                ? t("onboarding.step6.saving")
                : files.length === 0
                  ? t("onboarding.step6.skipFinish")
                  : t("onboarding.step6.complete")}
            </Button>
          </div>
        </div>
      </Card>
      <OnboardingExit />

      {/* Recovery dialog for /onboarding/complete failures.
          Without this a 500 just showed a toast and stranded the
          user in step 6 with no clear next move. Two explicit
          options: retry the same submit, or hard-reset (deletes
          the user row + any orphan tenant row, frees the email
          for re-registration). */}
      <Dialog
        open={failOpen}
        onOpenChange={(next) => {
          if (abortingAccount || mutation.isPending) return;
          setFailOpen(next);
        }}
      >
        <DialogContent className="sm:max-w-[460px]">
          <DialogHeader>
            <DialogTitle>{t("onboarding.step6.fail.title")}</DialogTitle>
            <DialogDescription>{failMessage}</DialogDescription>
          </DialogHeader>
          <p className="text-[13px] text-text-2">
            {t("onboarding.step6.fail.body")}
          </p>
          <DialogFooter className="flex-col gap-2 sm:flex-row">
            <Button
              variant="ghost"
              onClick={onStartOver}
              disabled={abortingAccount || mutation.isPending}
              className="text-danger-6 hover:text-danger-7 hover:bg-danger-1/40"
            >
              {abortingAccount
                ? t("onboarding.step6.fail.startingOver")
                : t("onboarding.step6.fail.startOver")}
            </Button>
            <Button
              onClick={() => {
                setFailOpen(false);
                mutation.mutate();
              }}
              disabled={mutation.isPending || abortingAccount}
              className="bg-primary-6 hover:bg-primary-7 text-white"
            >
              {mutation.isPending ? t("onboarding.step6.fail.retrying") : t("onboarding.step6.fail.retry")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
