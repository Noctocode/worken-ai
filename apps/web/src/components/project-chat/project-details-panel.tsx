"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  BookOpen,
  Check,
  ChevronDown,
  Download,
  FileText,
  Loader2,
  PanelRightClose,
  PanelRightOpen,
  Paperclip,
  Pencil,
  ScrollText,
  Sparkles,
  Unplug,
  Users,
  Wrench,
  X,
} from "lucide-react";
import { toast } from "sonner";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { AddDocumentDialog } from "@/components/add-document-dialog";
import {
  detachKnowledgeFile,
  downloadKnowledgeFile,
  fetchDocuments,
  fetchPrompts,
  fetchProjectKnowledgeFiles,
  fetchProjectMembers,
  updateConversationContext,
  type ChatAttachment,
  type ConversationWithMessages,
  type ProjectMember,
} from "@/lib/api";
import { useIsPersonal } from "@/lib/hooks/use-is-personal";
import { useOnlineUsers } from "@/components/realtime-provider";
import { useLanguage } from "@/lib/i18n";
import type { TranslationKey } from "@/lib/translations/en";

interface Props {
  projectId: string;
  /** The currently-open conversation (null on a fresh, unsaved chat).
   *  Drives the Chat Context section's value + edit availability. */
  conversation: ConversationWithMessages | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Insert a prompt body into the composer (Prompts Library click). */
  onPickPrompt: (text: string) => void;
}

/* ─── Helpers ────────────────────────────────────────────────────────────── */

function formatBytes(bytes: number): string {
  if (!bytes) return "—";
  const units = ["B", "KB", "MB", "GB"];
  let n = bytes;
  let i = 0;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i++;
  }
  return `${n.toFixed(n < 10 && i > 0 ? 1 : 0)} ${units[i]}`;
}

function fileExt(name: string, fallback: string | null): string {
  const fromName = name.includes(".") ? name.split(".").pop() : null;
  return (fromName || fallback || "").toUpperCase();
}

function getInitials(name: string | null) {
  if (!name) return "?";
  return name
    .split(" ")
    .map((w) => w[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

function roleLabel(role: ProjectMember["role"], t: (k: TranslationKey) => string) {
  switch (role) {
    case "admin":
      return t("projDetails.roleAdmin");
    case "editor":
      return t("projDetails.roleEditor");
    case "viewer":
      return t("projDetails.roleViewer");
    default:
      return role;
  }
}

/* ─── Collapsible section ────────────────────────────────────────────────── */

function Section({
  icon: Icon,
  title,
  defaultOpen = false,
  sectionId,
  openToken = 0,
  children,
}: {
  icon: React.ElementType;
  title: string;
  defaultOpen?: boolean;
  /** Stable id used as the scroll target (`pd-section-<id>`) when the
   *  collapsed rail jumps here. */
  sectionId?: string;
  /** Bumped by the parent to force this section open (rail icon click). */
  openToken?: number;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  // Force-open when the parent targets this section from the rail.
  useEffect(() => {
    if (openToken > 0) setOpen(true);
  }, [openToken]);
  return (
    <div
      id={sectionId ? `pd-section-${sectionId}` : undefined}
      className="border-b border-border-2"
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full cursor-pointer items-center gap-2 px-4 py-3 text-left"
      >
        <Icon className="h-4 w-4 shrink-0 text-text-2" />
        <span className="flex-1 text-[13px] font-semibold text-text-1">
          {title}
        </span>
        <ChevronDown
          className={`h-4 w-4 shrink-0 text-text-3 transition-transform ${
            open ? "rotate-180" : ""
          }`}
        />
      </button>
      {open && <div className="px-4 pb-4">{children}</div>}
    </div>
  );
}

/* ─── Panel ──────────────────────────────────────────────────────────────── */

/**
 * Right-hand "Project Details" panel (Figma 238:17561). Five
 * collapsible sections — Chat Context (editable), Prompts Library,
 * Data Sources, AI Tools (coming soon), Team Members. Reuses the
 * existing project endpoints; only Chat Context writes (PATCH
 * /conversations/:id). When `open` is false we render a thin rail with
 * an expand affordance, mirroring the Figma "sidebars hidden" frame.
 */
export function ProjectDetailsPanel({
  projectId,
  conversation,
  open,
  onOpenChange,
  onPickPrompt,
}: Props) {
  const { t } = useLanguage();
  const qc = useQueryClient();
  // Personal profiles have no team — `fetchProjectMembers` returns no
  // rows (it excludes the owner), so the Team Members section would
  // just show an empty "no members" state. Hide it (and skip the
  // fetch) for them, consistent with main's personal-account model.
  const isPersonal = useIsPersonal();
  const onlineUserIds = useOnlineUsers();

  /* Chat Context edit state */
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const conversationId = conversation?.id ?? null;
  const context = conversation?.context ?? null;

  // Files in THIS chat's context — the unique attachments across all of
  // the conversation's messages (metadata.attachments). These are the
  // documents the model actually reads for this chat (test.docx etc.),
  // distinct from the project-wide Data Sources below.
  const chatFiles = useMemo<ChatAttachment[]>(() => {
    const msgs = conversation?.messages ?? [];
    const seen = new Set<string>();
    const out: ChatAttachment[] = [];
    for (const m of msgs) {
      const meta =
        m.metadata && typeof m.metadata === "object"
          ? (m.metadata as Record<string, unknown>)
          : null;
      const atts = Array.isArray(meta?.attachments)
        ? (meta.attachments as ChatAttachment[])
        : [];
      for (const a of atts) {
        if (a && typeof a.fileId === "string" && !seen.has(a.fileId)) {
          seen.add(a.fileId);
          out.push({ fileId: a.fileId, name: a.name, fileType: a.fileType });
        }
      }
    }
    return out;
  }, [conversation?.messages]);

  // Leave edit mode whenever the active conversation changes so a
  // half-typed draft can't bleed across chats. Adjusting state during
  // render (React's documented pattern) instead of an effect avoids a
  // cascading-render round-trip.
  const [trackedConvId, setTrackedConvId] = useState(conversationId);
  if (conversationId !== trackedConvId) {
    setTrackedConvId(conversationId);
    setEditing(false);
    setDraft("");
  }

  const contextMutation = useMutation({
    mutationFn: (value: string) =>
      updateConversationContext(conversationId!, value),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["conversation", conversationId] });
      setEditing(false);
      toast.success(t("projDetails.contextSaved"));
    },
    onError: (err: Error) =>
      toast.error(err.message || t("projDetails.contextSaveFailed")),
  });

  /* Detach a file from the project (removes the project_knowledge_files
   *  link so RAG stops feeding it; the KC file itself is untouched). */
  const detachMutation = useMutation({
    mutationFn: (fileId: string) => detachKnowledgeFile(projectId, fileId),
    onSuccess: () => {
      qc.invalidateQueries({
        queryKey: ["project-knowledge-files", projectId],
      });
      toast.success(t("projDetails.fileDetached"));
    },
    onError: (err: Error) =>
      toast.error(err.message || t("projDetails.detachFailed")),
  });

  /* Project-level context = the pasted-text "Manage Context" documents
   *  (shared across every chat in the project). Opened for editing via
   *  the same AddDocumentDialog the dashboard uses. */
  const [manageContextOpen, setManageContextOpen] = useState(false);

  /* Collapsed-rail → section jump: clicking a rail icon expands the
   *  panel, force-opens the target section, and scrolls it into view.
   *  openToken is bumped on every click so re-clicking the same icon
   *  (while already expanded) re-triggers the scroll. */
  const [targetSection, setTargetSection] = useState<string | null>(null);
  const [openToken, setOpenToken] = useState(0);
  const jumpToSection = useCallback(
    (id: string) => {
      setTargetSection(id);
      setOpenToken((n) => n + 1);
      onOpenChange(true);
    },
    [onOpenChange],
  );
  useEffect(() => {
    if (!open || !targetSection) return;
    const el = document.getElementById(`pd-section-${targetSection}`);
    if (!el) return;
    requestAnimationFrame(() =>
      el.scrollIntoView({ block: "start", behavior: "smooth" }),
    );
  }, [open, openToken, targetSection]);

  /* Section data — fetched only when the panel is open. */
  const { data: documents = [], isLoading: documentsLoading } = useQuery({
    queryKey: ["documents", projectId],
    queryFn: () => fetchDocuments(projectId),
    enabled: open,
  });
  const { data: prompts = [], isLoading: promptsLoading } = useQuery({
    queryKey: ["prompts"],
    queryFn: fetchPrompts,
    enabled: open,
  });
  const { data: files = [], isLoading: filesLoading } = useQuery({
    queryKey: ["project-knowledge-files", projectId],
    queryFn: () => fetchProjectKnowledgeFiles(projectId),
    enabled: open,
  });
  const { data: members = [], isLoading: membersLoading } = useQuery({
    queryKey: ["project-members", projectId],
    queryFn: () => fetchProjectMembers(projectId),
    enabled: open && !isPersonal,
  });

  const AI_TOOLS = [
    t("projDetails.toolSummary"),
    t("projDetails.toolRequirements"),
    t("projDetails.toolReport"),
    t("projDetails.toolTrends"),
  ];

  /* Collapsed rail — an icon strip mirroring the expanded sections
   *  (Figma "collapsed sidebar"). The expand button sits on top; each
   *  section icon expands the panel and scrolls to that section. */
  const railSections: {
    id: string;
    icon: React.ElementType;
    label: string;
  }[] = [
    { id: "projectContext", icon: ScrollText, label: t("projDetails.projectContext") },
    { id: "dataSources", icon: FileText, label: t("projDetails.dataSources") },
    { id: "chatContext", icon: Sparkles, label: t("projDetails.chatContext") },
    { id: "chatFiles", icon: Paperclip, label: t("projDetails.chatFiles") },
    { id: "promptsLibrary", icon: BookOpen, label: t("projDetails.promptsLibrary") },
    { id: "aiTools", icon: Wrench, label: t("projDetails.aiTools") },
    ...(isPersonal
      ? []
      : [{ id: "teamMembers", icon: Users, label: t("projDetails.teamMembers") }]),
  ];

  if (!open) {
    return (
      <div className="hidden w-12 shrink-0 flex-col items-center gap-1 border-l border-border-2 bg-bg-white py-3 xl:flex">
        <button
          type="button"
          onClick={() => onOpenChange(true)}
          title={t("projDetails.expand")}
          aria-label={t("projDetails.expand")}
          className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg text-text-3 hover:bg-bg-1 hover:text-text-1"
        >
          <PanelRightOpen className="h-5 w-5" />
        </button>
        <div className="my-1 h-px w-6 bg-border-2" />
        {railSections.map((s) => (
          <button
            key={s.id}
            type="button"
            onClick={() => jumpToSection(s.id)}
            title={s.label}
            aria-label={s.label}
            className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg text-text-3 hover:bg-bg-1 hover:text-text-1"
          >
            <s.icon className="h-[18px] w-[18px]" />
          </button>
        ))}
      </div>
    );
  }

  return (
    <div className="hidden w-80 shrink-0 flex-col overflow-hidden border-l border-border-2 bg-bg-white xl:flex">
      <div className="flex h-14 shrink-0 items-center justify-between border-b border-border-2 px-4">
        <h3 className="text-[14px] font-bold text-text-1">
          {t("projDetails.title")}
        </h3>
        <button
          type="button"
          onClick={() => onOpenChange(false)}
          title={t("projDetails.collapse")}
          className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg text-text-3 hover:bg-bg-1 hover:text-text-1"
        >
          <PanelRightClose className="h-5 w-5" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto">
        {/* ── Project context (Manage Context) ──────────────────── */}
        <Section
          icon={ScrollText}
          title={t("projDetails.projectContext")}
          defaultOpen
          sectionId="projectContext"
          openToken={targetSection === "projectContext" ? openToken : 0}
        >
          <div className="space-y-2">
            {documentsLoading ? (
              <Loader2 className="h-4 w-4 animate-spin text-text-3" />
            ) : documents.length === 0 ? (
              <p className="text-[12px] text-text-3">
                {t("projDetails.noProjectContext")}
              </p>
            ) : (
              <div className="space-y-2">
                {documents.map((d) => (
                  <p
                    key={d.id}
                    className="whitespace-pre-wrap rounded-lg border border-border-2 bg-bg-1 p-2.5 text-[12px] leading-relaxed text-text-2"
                  >
                    {d.content}
                  </p>
                ))}
              </div>
            )}
            <button
              type="button"
              onClick={() => setManageContextOpen(true)}
              className="inline-flex cursor-pointer items-center gap-1.5 text-[12px] font-medium text-primary-6 hover:text-primary-7"
            >
              <Pencil className="h-3.5 w-3.5" />
              {t("projDetails.manageContext")}
            </button>
          </div>
        </Section>

        {/* ── Data Sources ──────────────────────────────────────── */}
        <Section
          icon={FileText}
          title={t("projDetails.dataSources")}
          defaultOpen
          sectionId="dataSources"
          openToken={targetSection === "dataSources" ? openToken : 0}
        >
          {filesLoading ? (
            <Loader2 className="h-4 w-4 animate-spin text-text-3" />
          ) : files.length === 0 ? (
            <p className="text-[12px] text-text-3">
              {t("projDetails.noDataSources")}
            </p>
          ) : (
            <ul className="flex flex-col gap-2">
              {files.map((f) => (
                <li
                  key={f.fileId}
                  className="group flex items-start gap-2 rounded-lg border border-border-2 bg-bg-white px-2.5 py-2 transition-colors hover:border-primary-5"
                >
                  {/* Click the file to download it (same as the chat
                      attachment chips). */}
                  <button
                    type="button"
                    onClick={() =>
                      downloadKnowledgeFile(f.fileId, f.name).catch(() =>
                        toast.error(t("projDetails.chatFileDownloadFailed")),
                      )
                    }
                    title={t("projDetails.chatFileDownload")}
                    className="flex min-w-0 flex-1 cursor-pointer items-start gap-2 text-left"
                  >
                    <FileText className="mt-0.5 h-4 w-4 shrink-0 text-text-3" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[12px] font-medium text-text-1">
                        {f.name}
                      </span>
                      <span className="block text-[11px] text-text-3">
                        {formatBytes(f.sizeBytes)} • {fileExt(f.name, f.fileType)}{" "}
                        •{" "}
                        {new Date(f.attachedAt).toLocaleDateString(undefined, {
                          year: "numeric",
                          month: "short",
                          day: "numeric",
                        })}
                      </span>
                    </span>
                  </button>
                  {/* Detach = remove the project link so RAG stops
                      feeding this file. The KC file itself stays. */}
                  <button
                    type="button"
                    onClick={() => detachMutation.mutate(f.fileId)}
                    disabled={detachMutation.isPending}
                    title={t("projDetails.detachFile")}
                    aria-label={t("projDetails.detachFile")}
                    className="mt-0.5 flex h-5 w-5 shrink-0 cursor-pointer items-center justify-center rounded text-text-3 opacity-0 transition-opacity hover:text-danger-6 group-hover:opacity-100 disabled:cursor-not-allowed"
                  >
                    <Unplug className="h-3.5 w-3.5" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Section>

        {/* ── Chat Context (per-conversation) ───────────────────── */}
        <Section
          icon={Sparkles}
          title={t("projDetails.chatContext")}
          defaultOpen
          sectionId="chatContext"
          openToken={targetSection === "chatContext" ? openToken : 0}
        >
          {!conversationId ? (
            <p className="text-[12px] text-text-3">
              {t("projDetails.contextNeedsChat")}
            </p>
          ) : editing ? (
            <div className="space-y-2">
              <textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder={t("projDetails.contextPh")}
                rows={6}
                autoFocus
                disabled={contextMutation.isPending}
                className="w-full resize-y rounded-lg border border-border-2 bg-bg-white p-2.5 text-[12px] leading-relaxed text-text-1 placeholder:text-text-3 focus:border-primary-5 focus:outline-none disabled:opacity-60"
              />
              <div className="flex justify-end gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 gap-1 px-2 text-[12px]"
                  onClick={() => setEditing(false)}
                  disabled={contextMutation.isPending}
                >
                  <X className="h-3.5 w-3.5" />
                  {t("projDetails.cancel")}
                </Button>
                <Button
                  size="sm"
                  className="h-7 gap-1 bg-primary-6 px-2 text-[12px] hover:bg-primary-7"
                  onClick={() => contextMutation.mutate(draft)}
                  disabled={contextMutation.isPending}
                >
                  {contextMutation.isPending ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Check className="h-3.5 w-3.5" />
                  )}
                  {t("projDetails.saveContext")}
                </Button>
              </div>
            </div>
          ) : (
            <div className="space-y-2">
              {context ? (
                <p className="whitespace-pre-wrap text-[12px] leading-relaxed text-text-2">
                  {context}
                </p>
              ) : (
                <p className="text-[12px] text-text-3">
                  {t("projDetails.noContext")}
                </p>
              )}
              <button
                type="button"
                onClick={() => {
                  setDraft(context ?? "");
                  setEditing(true);
                }}
                className="inline-flex cursor-pointer items-center gap-1.5 text-[12px] font-medium text-primary-6 hover:text-primary-7"
              >
                <Pencil className="h-3.5 w-3.5" />
                {t("projDetails.editContext")}
              </button>
            </div>
          )}
        </Section>

        {/* ── Files in this chat ────────────────────────────────── */}
        <Section
          icon={Paperclip}
          title={t("projDetails.chatFiles")}
          defaultOpen={chatFiles.length > 0}
          sectionId="chatFiles"
          openToken={targetSection === "chatFiles" ? openToken : 0}
        >
          {chatFiles.length === 0 ? (
            <p className="text-[12px] text-text-3">
              {t("projDetails.noChatFiles")}
            </p>
          ) : (
            <ul className="flex flex-col gap-1.5">
              {chatFiles.map((f) => (
                <li key={f.fileId}>
                  <button
                    type="button"
                    onClick={() =>
                      downloadKnowledgeFile(f.fileId, f.name).catch(() =>
                        toast.error(t("projDetails.chatFileDownloadFailed")),
                      )
                    }
                    title={t("projDetails.chatFileDownload")}
                    className="flex w-full cursor-pointer items-center gap-2 rounded-lg border border-border-2 bg-bg-white px-2.5 py-2 text-left transition-colors hover:border-primary-5"
                  >
                    <FileText className="h-4 w-4 shrink-0 text-text-3" />
                    <span className="min-w-0 flex-1 truncate text-[12px] font-medium text-text-1">
                      {f.name}
                    </span>
                    <Download className="h-3.5 w-3.5 shrink-0 text-text-3" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Section>

        {/* ── Prompts Library ───────────────────────────────────── */}
        <Section
          icon={BookOpen}
          title={t("projDetails.promptsLibrary")}
          sectionId="promptsLibrary"
          openToken={targetSection === "promptsLibrary" ? openToken : 0}
        >
          {promptsLoading ? (
            <Loader2 className="h-4 w-4 animate-spin text-text-3" />
          ) : prompts.length === 0 ? (
            <p className="text-[12px] text-text-3">
              {t("projDetails.noPrompts")}
            </p>
          ) : (
            <ul className="flex flex-col gap-1.5">
              {prompts.slice(0, 8).map((p) => (
                <li key={p.id}>
                  <button
                    type="button"
                    onClick={() => onPickPrompt(p.body)}
                    className="w-full cursor-pointer rounded-lg border border-border-2 bg-bg-white px-2.5 py-2 text-left text-[12px] font-medium text-text-2 transition-colors hover:border-primary-5 hover:text-text-1"
                  >
                    {p.title}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Section>


        {/* ── AI Tools (coming soon) ────────────────────────────── */}
        <Section
          icon={Wrench}
          title={t("projDetails.aiTools")}
          sectionId="aiTools"
          openToken={targetSection === "aiTools" ? openToken : 0}
        >
          <div className="mb-2">
            <span className="inline-flex items-center rounded-md bg-bg-1 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-text-3">
              {t("projDetails.comingSoon")}
            </span>
          </div>
          <ul className="flex flex-col gap-1.5">
            {AI_TOOLS.map((tool) => (
              <li
                key={tool}
                className="cursor-not-allowed rounded-lg border border-dashed border-border-2 px-2.5 py-2 text-[12px] text-text-3"
              >
                {tool}
              </li>
            ))}
          </ul>
        </Section>

        {/* ── Team Members ──────────────────────────────────────── */}
        {/* Hidden for personal profiles — they have no team, so the
            list is always empty. */}
        {!isPersonal && (
        <Section
          icon={Users}
          title={t("projDetails.teamMembers")}
          defaultOpen
          sectionId="teamMembers"
          openToken={targetSection === "teamMembers" ? openToken : 0}
        >
          {membersLoading ? (
            <Loader2 className="h-4 w-4 animate-spin text-text-3" />
          ) : members.length === 0 ? (
            <p className="text-[12px] text-text-3">
              {t("projDetails.noMembers")}
            </p>
          ) : (
            <ul className="flex flex-col gap-2.5">
              {members.map((m) => {
                const online = onlineUserIds.has(m.userId);
                return (
                <li key={m.userId} className="flex items-center gap-2.5">
                  <div className="relative shrink-0">
                    <Avatar className="h-8 w-8 border border-border-2">
                      {m.userPicture ? (
                        <AvatarImage
                          src={m.userPicture}
                          alt={m.userName ?? m.userEmail}
                        />
                      ) : null}
                      <AvatarFallback className="bg-primary-1 text-[11px] font-medium text-primary-6">
                        {getInitials(m.userName ?? m.userEmail)}
                      </AvatarFallback>
                    </Avatar>
                    {/* Live presence dot — green when the member has an
                        active socket (FA4), muted grey when offline. */}
                    <span
                      title={
                        online
                          ? t("projDetails.online")
                          : t("projDetails.offline")
                      }
                      className={`absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-bg-white ${
                        online ? "bg-success-7" : "bg-bg-3"
                      }`}
                    />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13px] font-medium text-text-1">
                      {m.userName ?? m.userEmail}
                    </p>
                    <p className="truncate text-[11px] text-text-3">
                      {roleLabel(m.role, t)}
                      {m.status === "pending" && ` · ${t("projDetails.pending")}`}
                    </p>
                  </div>
                </li>
                );
              })}
            </ul>
          )}
        </Section>
        )}
      </div>

      {/* Project context editor — same dialog the dashboard uses. */}
      <AddDocumentDialog
        projectId={projectId}
        open={manageContextOpen}
        onOpenChange={setManageContextOpen}
      />
    </div>
  );
}
