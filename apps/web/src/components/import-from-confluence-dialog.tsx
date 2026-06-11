"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  AlertTriangle,
  BookOpen,
  ChevronDown,
  ChevronRight,
  FileText,
  Loader2,
  XCircle,
} from "lucide-react";

import {
  cancelConfluenceImport,
  fetchConfluenceImportProgress,
  fetchConfluencePages,
  fetchConfluenceSpaceFileCount,
  fetchConfluenceSpaces,
  fetchProjects,
  fetchTeams,
  importFromConfluence,
  startConfluenceImportAsync,
  type ConfluenceImportProgress,
  type ConfluencePage,
  type KnowledgeFileVisibility,
} from "@/lib/api";
import { useAuth } from "@/components/providers";
import { Button } from "@/components/ui/button";
import { DisabledReasonTooltip } from "@/components/ui/tooltip";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useLanguage } from "@/lib/i18n";

type ImportScopeChoice = "space" | "pages";

interface PageNodeProps {
  page: ConfluencePage;
  depth: number;
  childrenByParent: Map<string, ConfluencePage[]>;
  expanded: Set<string>;
  selected: Set<string>;
  onToggleExpand: (id: string) => void;
  onToggleSelect: (id: string) => void;
}

function PageNode({
  page,
  depth,
  childrenByParent,
  expanded,
  selected,
  onToggleExpand,
  onToggleSelect,
}: PageNodeProps) {
  const { t } = useLanguage();
  const isExpanded = expanded.has(page.id);
  const isSelected = selected.has(page.id);
  const kids = childrenByParent.get(page.id) ?? [];

  return (
    <li>
      <div
        className="flex items-center gap-2 rounded px-2 py-1.5 hover:bg-bg-1"
        style={{ paddingLeft: `${depth * 16 + 8}px` }}
      >
        <button
          type="button"
          onClick={() => page.hasChildren && onToggleExpand(page.id)}
          className={`flex h-5 w-5 shrink-0 cursor-pointer items-center justify-center rounded text-text-3 ${
            page.hasChildren
              ? "hover:bg-bg-white hover:text-text-1"
              : "invisible"
          }`}
          aria-label={
            isExpanded
              ? t("confluenceDlg.collapse")
              : t("confluenceDlg.expand")
          }
        >
          {isExpanded ? (
            <ChevronDown className="h-3.5 w-3.5" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5" />
          )}
        </button>
        <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-2">
          <input
            type="checkbox"
            checked={isSelected}
            onChange={() => onToggleSelect(page.id)}
            className="h-4 w-4 shrink-0 cursor-pointer accent-primary-6"
          />
          <FileText
            className="h-4 w-4 shrink-0 text-primary-6"
            strokeWidth={1.5}
          />
          <span className="truncate text-[13px] text-text-1">
            {page.title}
          </span>
        </label>
      </div>
      {isExpanded && kids.length > 0 && (
        <ul>
          {kids.map((child) => (
            <PageNode
              key={child.id}
              page={child}
              depth={depth + 1}
              childrenByParent={childrenByParent}
              expanded={expanded}
              selected={selected}
              onToggleExpand={onToggleExpand}
              onToggleSelect={onToggleSelect}
            />
          ))}
        </ul>
      )}
    </li>
  );
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ImportFromConfluenceDialog({ open, onOpenChange }: Props) {
  const { t } = useLanguage();
  const queryClient = useQueryClient();
  const { user: currentUser } = useAuth();
  const isAdmin = currentUser?.role === "admin";

  const [spaceId, setSpaceId] = useState<string>("");
  const [scopeChoice, setScopeChoice] = useState<ImportScopeChoice>("space");
  const [entireSpaceConfirmed, setEntireSpaceConfirmed] = useState(false);
  const [visibility, setVisibility] = useState<KnowledgeFileVisibility>("all");
  const [selectedTeamIds, setSelectedTeamIds] = useState<string[]>([]);
  const [selectedProjectIds, setSelectedProjectIds] = useState<string[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const [asyncJobActive, setAsyncJobActive] = useState(false);
  const handledPhaseRef = useRef<string | null>(null);

  const {
    data: spaces = [],
    isLoading: spacesLoading,
    isError: spacesIsError,
    error: spacesError,
  } = useQuery({
    queryKey: ["confluence", "spaces"],
    queryFn: fetchConfluenceSpaces,
    enabled: open,
  });

  const { data: userTeams = [] } = useQuery({
    queryKey: ["teams"],
    queryFn: fetchTeams,
    enabled: open,
  });
  const { data: userProjects = [] } = useQuery({
    queryKey: ["projects", "confluence-import"],
    queryFn: () => fetchProjects("all"),
    enabled: open,
  });

  // Page-count estimate for the "Entire space" warning banner.
  const {
    data: fileCountData,
    isLoading: fileCountLoading,
    isError: fileCountError,
  } = useQuery({
    queryKey: ["confluence", "file-count", spaceId],
    queryFn: () => fetchConfluenceSpaceFileCount(spaceId),
    enabled: open && scopeChoice === "space" && !!spaceId,
    retry: 1,
  });

  // Full page list for the chosen space (powers the "Choose pages" tree).
  const {
    data: pages = [],
    isLoading: pagesLoading,
    isError: pagesError,
  } = useQuery({
    queryKey: ["confluence", "pages", spaceId],
    queryFn: () => fetchConfluencePages(spaceId),
    enabled: open && scopeChoice === "pages" && !!spaceId,
  });

  const { childrenByParent, roots } = useMemo(() => {
    const map = new Map<string, ConfluencePage[]>();
    const rootList: ConfluencePage[] = [];
    for (const p of pages) {
      if (p.parentId) {
        const arr = map.get(p.parentId) ?? [];
        arr.push(p);
        map.set(p.parentId, arr);
      } else {
        rootList.push(p);
      }
    }
    return { childrenByParent: map, roots: rootList };
  }, [pages]);

  // ── Async progress polling ────────────────────────────────────────
  const { data: progress, isSuccess: progressFetched } =
    useQuery<ConfluenceImportProgress | null>({
      queryKey: ["confluence", "import-progress"],
      queryFn: fetchConfluenceImportProgress,
      enabled: open,
      refetchInterval: (query) => {
        const p = query.state.data;
        if (!p) return asyncJobActive ? 2000 : false;
        if (p.phase === "scanning" || p.phase === "importing") return 2000;
        return false;
      },
      staleTime: 0,
    });

  useEffect(() => {
    if (!open || !progressFetched) return;
    const running =
      progress?.phase === "scanning" || progress?.phase === "importing";
    setAsyncJobActive(running);
  }, [open, progressFetched, progress?.phase]);

  // React to terminal phases (done / cancelled / error).
  useEffect(() => {
    if (!progress) return;
    const { phase } = progress;
    if (phase === handledPhaseRef.current) return;
    if (phase !== "done" && phase !== "cancelled" && phase !== "error") return;

    handledPhaseRef.current = phase;
    setAsyncJobActive(false);

    if (phase === "done") {
      if (progress.imported === 0) {
        toast.info(t("confluenceDlg.allInKC"));
      } else {
        toast.success(
          `${t("confluenceDlg.imported1")} ${progress.imported.toLocaleString()} ${progress.imported === 1 ? t("confluenceDlg.imported2") : t("confluenceDlg.imported2Plural")} ${t("confluenceDlg.fromConfluence")}`,
        );
      }
      void queryClient.invalidateQueries({
        queryKey: ["confluence", "sources"],
      });
      void queryClient.invalidateQueries({ queryKey: ["knowledge-folders"] });
      void queryClient.invalidateQueries({ queryKey: ["knowledge-recent"] });
      onOpenChange(false);
    } else if (phase === "cancelled") {
      toast.info(t("confluenceDlg.cancelled"));
    } else if (phase === "error") {
      toast.error(
        `${t("confluenceDlg.failed")} ${progress.error ?? t("confluenceDlg.unknownError")}`,
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [progress, onOpenChange, queryClient]);

  // Reset per-dialog state on every open. Auto-select the first space.
  useEffect(() => {
    if (!open) return;
    setScopeChoice("space");
    setEntireSpaceConfirmed(false);
    setVisibility("all");
    setSelectedTeamIds([]);
    setSelectedProjectIds([]);
    setSelected(new Set());
    setExpanded(new Set());
    handledPhaseRef.current = null;
  }, [open]);

  // Default the space picker to the first space once they load.
  useEffect(() => {
    if (open && !spaceId && spaces.length > 0) {
      setSpaceId(spaces[0].id);
    }
  }, [open, spaceId, spaces]);

  const toggleExpand = useCallback((id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const toggleSelect = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  // ── Page-scoped import (synchronous) ──────────────────────────────
  const pagesImportMutation = useMutation({
    mutationFn: async () => {
      const visibilityExtra = {
        visibility,
        teamIds: visibility === "teams" ? selectedTeamIds : undefined,
        projectIds: visibility === "project" ? selectedProjectIds : undefined,
      };
      return importFromConfluence({
        kind: "pages",
        spaceId,
        pageIds: Array.from(selected),
        ...visibilityExtra,
      });
    },
    onSuccess: (result) => {
      if (result.added === 0 && result.skippedDuplicates === 0) {
        toast.info(t("confluenceDlg.noPagesFound"));
      } else if (result.added === 0) {
        toast.info(t("confluenceDlg.pagesAllInKC"));
      } else {
        toast.success(
          `${t("confluenceDlg.importing1")} ${result.added} ${result.added === 1 ? t("confluenceDlg.imported2") : t("confluenceDlg.imported2Plural")} ${t("confluenceDlg.fromConfluence")}`,
        );
      }
      void queryClient.invalidateQueries({
        queryKey: ["confluence", "sources"],
      });
      void queryClient.invalidateQueries({ queryKey: ["knowledge-folders"] });
      void queryClient.invalidateQueries({ queryKey: ["knowledge-recent"] });
      onOpenChange(false);
    },
    onError: (err) => {
      toast.error(
        err instanceof Error ? err.message : t("confluenceDlg.importFailed"),
      );
    },
  });

  // ── Entire space import (async, shows progress) ───────────────────
  const startAsyncMutation = useMutation({
    mutationFn: () =>
      startConfluenceImportAsync({
        kind: "space",
        spaceId,
        visibility,
        teamIds: visibility === "teams" ? selectedTeamIds : undefined,
        projectIds: visibility === "project" ? selectedProjectIds : undefined,
      }),
    onSuccess: () => {
      handledPhaseRef.current = null;
      setAsyncJobActive(true);
      queryClient.setQueryData<ConfluenceImportProgress>(
        ["confluence", "import-progress"],
        { phase: "scanning", scanned: 0, total: 0, imported: 0 },
      );
    },
    onError: (err) => {
      toast.error(
        err instanceof Error ? err.message : t("confluenceDlg.importFailed"),
      );
    },
  });

  const cancelMutation = useMutation({
    mutationFn: cancelConfluenceImport,
    onSuccess: () => {
      setAsyncJobActive(false);
      void queryClient.invalidateQueries({
        queryKey: ["confluence", "import-progress"],
      });
    },
    onError: (err) =>
      toast.error(
        err instanceof Error ? err.message : t("confluenceDlg.cancelFailed"),
      ),
  });

  const visibilityValid =
    visibility !== "teams" || selectedTeamIds.length > 0
      ? visibility !== "project" || selectedProjectIds.length > 0
      : false;

  const canSubmit =
    !!spaceId &&
    !pagesImportMutation.isPending &&
    !startAsyncMutation.isPending &&
    (scopeChoice === "pages" ? selected.size > 0 : entireSpaceConfirmed) &&
    visibilityValid;

  const submitDisabledReason = !spaceId
    ? t("confluenceDlg.pickSpace")
    : pagesImportMutation.isPending || startAsyncMutation.isPending
      ? t("confluenceDlg.importInProgress")
      : scopeChoice === "pages" && selected.size === 0
        ? t("confluenceDlg.pickPage")
        : scopeChoice === "space" && !entireSpaceConfirmed
          ? t("confluenceDlg.confirmEntireFirst")
          : !visibilityValid
            ? t("confluenceDlg.selectTeamOrProject")
            : "";

  // ── Progress view (async job active) ──────────────────────────────
  const isRunning =
    asyncJobActive &&
    (!progress ||
      progress.phase === "scanning" ||
      progress.phase === "importing");

  if (isRunning) {
    const phase = progress?.phase ?? "scanning";
    const total = progress?.total ?? 0;
    const imported = progress?.imported ?? 0;
    const pct = total > 0 ? Math.round((imported / total) * 100) : 0;

    return (
      <Dialog open={open} onOpenChange={() => {}}>
        <DialogContent className="max-w-[480px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin text-primary-6" />
              {t("confluenceDlg.importingTitle")}
            </DialogTitle>
            <DialogDescription>
              {t("confluenceDlg.importingDesc")}
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-4 py-2">
            {phase === "scanning" ? (
              <div className="flex flex-col gap-1.5">
                <div className="flex items-center gap-2 text-[13px] text-text-3">
                  <Loader2 className="h-3.5 w-3.5 animate-spin shrink-0" />
                  {t("confluenceDlg.scanning")}
                </div>
                <div className="h-2 w-full overflow-hidden rounded-full bg-bg-2">
                  <div className="h-full w-1/3 animate-[scan-slide_1.4s_ease-in-out_infinite] rounded-full bg-primary-6" />
                </div>
              </div>
            ) : (
              <div className="flex flex-col gap-1.5">
                <div className="flex items-center justify-between text-[13px]">
                  <span className="text-text-3">
                    {t("confluenceDlg.importingPages")}
                  </span>
                  <span className="font-medium text-text-1 tabular-nums">
                    {imported.toLocaleString()} / {total.toLocaleString()}
                  </span>
                </div>
                <div className="h-2 w-full overflow-hidden rounded-full bg-bg-2">
                  <div
                    className="h-full rounded-full bg-primary-6 transition-all duration-500"
                    style={{ width: `${pct}%` }}
                  />
                </div>
                <p className="text-right text-[11px] text-text-3">{pct}%</p>
              </div>
            )}
          </div>

          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              onClick={() => onOpenChange(false)}
              className="cursor-pointer"
            >
              {t("confluenceDlg.close")}
            </Button>
            <Button
              variant="outline"
              onClick={() => cancelMutation.mutate()}
              disabled={cancelMutation.isPending}
              className="cursor-pointer gap-2 border-danger-4 text-danger-6 hover:bg-danger-1"
            >
              {cancelMutation.isPending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <XCircle className="h-3.5 w-3.5" />
              )}
              {t("confluenceDlg.cancelImport")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }

  // ── Page-scoped working view (synchronous) ────────────────────────
  if (pagesImportMutation.isPending) {
    return (
      <Dialog open={open} onOpenChange={() => {}}>
        <DialogContent className="max-w-[480px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin text-primary-6" />
              {t("confluenceDlg.importingPagesTitle")}
            </DialogTitle>
            <DialogDescription>
              {t("confluenceDlg.importingPagesDesc")}
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-4 py-2">
            <div className="h-2 w-full overflow-hidden rounded-full bg-bg-2">
              <div className="h-full w-1/3 animate-[scan-slide_1.4s_ease-in-out_infinite] rounded-full bg-primary-6" />
            </div>
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  // ── Normal (config) view ──────────────────────────────────────────
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* [&>*]:min-w-0 lets the grid children shrink below their content
          width — without it a long space label (personal-space keys are
          ~40-char ids) forces the grid column wider than the dialog and the
          form fields overflow the right edge. */}
      <DialogContent className="max-w-[560px] [&>*]:min-w-0">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <BookOpen className="h-4 w-4 text-primary-6" />
            {t("confluenceDlg.title")}
          </DialogTitle>
          <DialogDescription>{t("confluenceDlg.desc")}</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          {/* Space picker */}
          <div className="flex flex-col gap-1.5">
            <label className="text-[12px] font-medium text-text-1">
              {t("confluenceDlg.space")}
            </label>
            {spacesLoading ? (
              <div className="flex items-center gap-2 px-1 py-2 text-[13px] text-text-3">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                {t("confluenceDlg.loadingSpaces")}
              </div>
            ) : spacesIsError ? (
              <p className="px-1 py-2 text-[13px] text-danger-6">
                {spacesError instanceof Error
                  ? spacesError.message
                  : t("confluenceDlg.noSpaces")}
              </p>
            ) : spaces.length === 0 ? (
              <p className="px-1 py-2 text-[13px] text-text-3">
                {t("confluenceDlg.noSpaces")}
              </p>
            ) : (
              <Select
                value={spaceId}
                onValueChange={(v) => {
                  setSpaceId(v);
                  setSelected(new Set());
                  setExpanded(new Set());
                  setEntireSpaceConfirmed(false);
                }}
              >
                <SelectTrigger className="h-10 w-full min-w-0 cursor-pointer">
                  <SelectValue placeholder={t("confluenceDlg.selectSpace")} />
                </SelectTrigger>
                <SelectContent>
                  {spaces.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      <span className="truncate">{s.name}</span>
                      {/* Personal-space keys are opaque ~user-id strings —
                          only show a key worth reading (e.g. "ENG"). */}
                      {s.key && !s.key.startsWith("~") ? (
                        <span className="ml-1 shrink-0 text-text-3">
                          · {s.key}
                        </span>
                      ) : null}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>

          {/* Scope picker */}
          <div className="flex flex-col gap-2">
            <label className="flex cursor-pointer items-start gap-3 rounded border border-border-2 p-3 hover:bg-bg-1">
              <input
                type="radio"
                checked={scopeChoice === "space"}
                onChange={() => {
                  setScopeChoice("space");
                  setEntireSpaceConfirmed(false);
                }}
                className="mt-0.5 h-4 w-4 cursor-pointer accent-primary-6"
              />
              <div className="flex flex-col gap-0.5">
                <span className="text-[14px] font-medium text-text-1">
                  {t("confluenceDlg.entireSpace")}
                </span>
                <span className="text-[12px] text-text-3">
                  {t("confluenceDlg.entireSpaceDesc")}
                </span>
              </div>
            </label>
            <label className="flex cursor-pointer items-start gap-3 rounded border border-border-2 p-3 hover:bg-bg-1">
              <input
                type="radio"
                checked={scopeChoice === "pages"}
                onChange={() => setScopeChoice("pages")}
                className="mt-0.5 h-4 w-4 cursor-pointer accent-primary-6"
              />
              <div className="flex flex-col gap-0.5">
                <span className="text-[14px] font-medium text-text-1">
                  {t("confluenceDlg.choosePages")}
                </span>
                <span className="text-[12px] text-text-3">
                  {t("confluenceDlg.choosePagesDesc")}
                </span>
              </div>
            </label>
          </div>

          {/* Entire space confirmation warning */}
          {scopeChoice === "space" && (
            <div className="flex flex-col gap-2 rounded border border-warning-3 bg-warning-1 p-3">
              <div className="flex items-start gap-2">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning-7" />
                <div className="flex flex-col gap-1">
                  <p className="text-[13px] font-medium text-warning-8">
                    {fileCountLoading ? (
                      <span className="flex items-center gap-1.5">
                        <Loader2 className="h-3 w-3 animate-spin" />
                        {t("confluenceDlg.checkingSpace")}
                      </span>
                    ) : fileCountData ? (
                      <>
                        {t("confluenceDlg.willImport")}{" "}
                        <span className="tabular-nums">
                          {fileCountData.count.toLocaleString()}
                          {fileCountData.hasMore ? "+" : ""}
                        </span>{" "}
                        {fileCountData.count === 1 && !fileCountData.hasMore
                          ? t("confluenceDlg.pageSing")
                          : t("confluenceDlg.pagePlural")}
                      </>
                    ) : fileCountError ? (
                      t("confluenceDlg.willImportAll")
                    ) : (
                      t("confluenceDlg.willImportSupported")
                    )}
                  </p>
                  <p className="text-[12px] text-warning-7">
                    {t("confluenceDlg.warnText")}
                  </p>
                </div>
              </div>
              <label className="flex cursor-pointer items-center gap-2 pl-6">
                <input
                  type="checkbox"
                  checked={entireSpaceConfirmed}
                  onChange={(e) => setEntireSpaceConfirmed(e.target.checked)}
                  className="h-4 w-4 cursor-pointer accent-warning-7"
                />
                <span className="text-[12px] font-medium text-warning-8">
                  {t("confluenceDlg.iUnderstand")}
                </span>
              </label>
            </div>
          )}

          {/* Page tree (only when "Choose pages" is selected) */}
          {scopeChoice === "pages" && (
            <div className="rounded border border-border-2 bg-bg-1/40 p-2">
              {pagesLoading && (
                <div className="flex items-center gap-2 px-2 py-3 text-[13px] text-text-3">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  {t("confluenceDlg.loadingPages")}
                </div>
              )}
              {pagesError && (
                <p className="px-2 py-3 text-[13px] text-danger-6">
                  {t("confluenceDlg.couldntListPages")}
                </p>
              )}
              {!pagesLoading && !pagesError && roots.length === 0 && (
                <p className="px-2 py-3 text-[13px] text-text-3">
                  {t("confluenceDlg.noPages")}
                </p>
              )}
              {roots.length > 0 && (
                <ul className="max-h-[280px] overflow-y-auto">
                  {roots.map((p) => (
                    <PageNode
                      key={p.id}
                      page={p}
                      depth={0}
                      childrenByParent={childrenByParent}
                      expanded={expanded}
                      selected={selected}
                      onToggleExpand={toggleExpand}
                      onToggleSelect={toggleSelect}
                    />
                  ))}
                </ul>
              )}
              {selected.size > 0 && (
                <p className="border-t border-border-2 px-2 pt-2 text-[11px] text-text-3">
                  {t("confluenceDlg.subtreeNote")}
                </p>
              )}
            </div>
          )}
        </div>

        {/* Visibility picker */}
        <div className="flex flex-col gap-1.5">
          <label className="text-[12px] font-medium text-text-1">
            {t("confluenceDlg.visibility")}
          </label>
          <Select
            value={visibility}
            onValueChange={(v) => {
              setVisibility(v as KnowledgeFileVisibility);
              setSelectedTeamIds([]);
              setSelectedProjectIds([]);
            }}
          >
            <SelectTrigger className="h-10 w-full cursor-pointer">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">
                {t("confluenceDlg.everyone")}
              </SelectItem>
              {isAdmin && (
                <SelectItem value="admins">
                  {t("confluenceDlg.adminsOnly")}
                </SelectItem>
              )}
              <SelectItem value="teams">
                {t("confluenceDlg.specificTeams")}
              </SelectItem>
              <SelectItem value="project">
                {t("confluenceDlg.specificProject")}
              </SelectItem>
            </SelectContent>
          </Select>
          <p className="text-[11px] text-text-3">
            {visibility === "admins"
              ? t("confluenceDlg.visHintAdmins")
              : visibility === "teams"
                ? t("confluenceDlg.visHintTeams")
                : visibility === "project"
                  ? t("confluenceDlg.visHintProject")
                  : t("confluenceDlg.visHintEveryone")}
          </p>
        </div>

        {/* Team picker */}
        {visibility === "teams" && (
          <div className="flex flex-col gap-1.5">
            <label className="text-[12px] font-medium text-text-1">
              {t("confluenceDlg.teamsWithAccess")}
            </label>
            {userTeams.length === 0 ? (
              <p className="text-[11px] text-text-3">
                {t("confluenceDlg.notTeamMember")}
              </p>
            ) : (
              <div className="flex max-h-36 flex-col gap-1 overflow-y-auto rounded border border-border-3 p-2">
                {userTeams.map((team) => {
                  const checked = selectedTeamIds.includes(team.id);
                  return (
                    <label
                      key={team.id}
                      className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-[13px] text-text-1 hover:bg-bg-1"
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() =>
                          setSelectedTeamIds((prev) =>
                            checked
                              ? prev.filter((id) => id !== team.id)
                              : [...prev, team.id],
                          )
                        }
                        className="h-3.5 w-3.5 cursor-pointer accent-primary-6"
                      />
                      <span className="truncate">{team.name}</span>
                    </label>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* Project picker */}
        {visibility === "project" && (
          <div className="flex flex-col gap-1.5">
            <label className="text-[12px] font-medium text-text-1">
              {t("confluenceDlg.projectsWithAccess")}
            </label>
            {userProjects.length === 0 ? (
              <p className="text-[11px] text-text-3">
                {t("confluenceDlg.noProjectAccess")}
              </p>
            ) : (
              <div className="flex max-h-36 flex-col gap-1 overflow-y-auto rounded border border-border-3 p-2">
                {userProjects.map((p) => {
                  const checked = selectedProjectIds.includes(p.id);
                  return (
                    <label
                      key={p.id}
                      className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-[13px] text-text-1 hover:bg-bg-1"
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() =>
                          setSelectedProjectIds((prev) =>
                            checked
                              ? prev.filter((id) => id !== p.id)
                              : [...prev, p.id],
                          )
                        }
                        className="h-3.5 w-3.5 cursor-pointer accent-primary-6"
                      />
                      <span className="truncate">
                        {p.name}
                        {p.teamName && (
                          <span className="ml-1 text-text-3">
                            · {p.teamName}
                          </span>
                        )}
                      </span>
                    </label>
                  );
                })}
              </div>
            )}
          </div>
        )}

        <DialogFooter className="gap-2">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            className="cursor-pointer"
          >
            {t("confluenceDlg.cancel")}
          </Button>
          <DisabledReasonTooltip
            disabled={!canSubmit}
            reason={submitDisabledReason}
          >
            <Button
              onClick={() =>
                scopeChoice === "space"
                  ? startAsyncMutation.mutate()
                  : pagesImportMutation.mutate()
              }
              disabled={!canSubmit}
              className="cursor-pointer gap-2"
            >
              {startAsyncMutation.isPending ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  {t("confluenceDlg.importing")}
                </>
              ) : scopeChoice === "space" ? (
                t("confluenceDlg.importEntire")
              ) : selected.size === 0 ? (
                t("confluenceDlg.pickPage")
              ) : (
                `${t("confluenceDlg.importNPages1")} ${selected.size} ${selected.size === 1 ? t("confluenceDlg.importNPages2") : t("confluenceDlg.importNPages2Plural")}`
              )}
            </Button>
          </DisabledReasonTooltip>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
