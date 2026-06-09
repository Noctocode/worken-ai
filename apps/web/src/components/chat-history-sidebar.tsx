"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Plus, MessageSquare, Loader2, Trash2, Search, Users } from "lucide-react";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { fetchConversations, deleteConversation } from "@/lib/api";
import { useQueryClient } from "@tanstack/react-query";
import { useIsPersonal } from "@/lib/hooks/use-is-personal";
import { useProjectActivity } from "@/components/realtime-provider";
import { useLanguage } from "@/lib/i18n";
import type { TranslationKey } from "@/lib/translations/en";

interface ChatHistorySidebarProps {
  projectId: string;
  activeConversationId: string | null;
  onSelectConversation: (id: string) => void;
  onNewChat: () => void;
}

type FilterTab = "all" | "personal" | "team";

function makeGetRelativeTime(t: (k: TranslationKey) => string) {
  return (dateStr: string) => {
    const now = Date.now();
    const date = new Date(dateStr).getTime();
    const diff = now - date;
    const minutes = Math.floor(diff / 60000);
    if (minutes < 1) return t("chatHist.justNow");
    if (minutes < 60) return `${minutes}${t("chatHist.mAgo")}`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}${t("chatHist.hAgo")}`;
    const days = Math.floor(hours / 24);
    return `${days}${t("chatHist.dAgo")}`;
  };
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

export function ChatHistorySidebar({
  projectId,
  activeConversationId,
  onSelectConversation,
  onNewChat,
}: ChatHistorySidebarProps) {
  const { t } = useLanguage();
  // Personal profiles have no teammates, so every conversation is
  // "personal" — the All/Personal/Team split is meaningless for them
  // (mirrors main's dashboard, which forces personal profiles to the
  // Personal view). Hide the tabs and show the full list instead.
  const isPersonal = useIsPersonal();
  const getRelativeTime = makeGetRelativeTime(t);
  const queryClient = useQueryClient();

  const [tab, setTab] = useState<FilterTab>("all");
  const [query, setQuery] = useState("");

  // Debounce the search term so each keystroke doesn't fire a request.
  // The setState lives in a timeout callback (async), so it doesn't
  // trip the set-state-in-effect lint rule.
  const [debouncedQuery, setDebouncedQuery] = useState("");
  useEffect(() => {
    const id = setTimeout(() => setDebouncedQuery(query.trim()), 250);
    return () => clearTimeout(id);
  }, [query]);

  // Server-side search across conversation titles AND message content.
  // The term is part of the query key so each distinct search caches
  // independently; invalidating ["conversations", projectId] (done on
  // send) matches all of them via react-query's prefix rule.
  const { data: conversations, isLoading } = useQuery({
    queryKey: ["conversations", projectId, debouncedQuery],
    queryFn: () => fetchConversations(projectId, debouncedQuery || undefined),
  });

  // Tab filter stays client-side — it's a cheap partition over the
  // already-fetched (and possibly already-searched) list.
  // Personal profiles never see the filter, so collapse to "all".
  const effectiveTab: FilterTab = isPersonal ? "all" : tab;
  const filtered = useMemo(() => {
    if (!conversations) return [];
    return conversations.filter((convo) => {
      const isTeam = convo.scope === "team";
      if (effectiveTab === "team" && !isTeam) return false;
      if (effectiveTab === "personal" && isTeam) return false;
      return true;
    });
  }, [conversations, effectiveTab]);

  // Live sidebar: refetch the list when another member adds a message or
  // a new conversation in this project (FA4 project room).
  const onProjectActivity = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ["conversations", projectId] });
  }, [queryClient, projectId]);
  useProjectActivity(projectId, onProjectActivity);

  const handleDelete = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    try {
      await deleteConversation(id);
      queryClient.invalidateQueries({ queryKey: ["conversations", projectId] });
      if (activeConversationId === id) {
        onNewChat();
      }
    } catch {
      // ignore
    }
  };

  const tabs: { key: FilterTab; label: string }[] = [
    { key: "all", label: t("chatHist.filterAll") },
    { key: "personal", label: t("chatHist.filterPersonal") },
    { key: "team", label: t("chatHist.filterTeam") },
  ];

  return (
    <div className="hidden w-72 min-w-0 shrink-0 flex-col overflow-hidden border-r border-slate-200/60 lg:flex">
      <div className="flex h-14 shrink-0 items-center justify-between px-4">
        <h2 className="text-sm font-semibold text-slate-900">{t("chatHist.title")}</h2>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 text-slate-500 hover:text-slate-900"
          onClick={onNewChat}
        >
          <Plus className="h-4 w-4" />
        </Button>
      </div>

      {/* Search */}
      <div className="px-3 pb-2">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("chatHist.searchPh")}
            className="h-9 w-full rounded-lg border border-slate-200 bg-white pl-8 pr-3 text-[13px] text-slate-900 placeholder:text-slate-400 focus:border-primary-5 focus:outline-none"
          />
        </div>
      </div>

      {/* Filter tabs — hidden for personal profiles (no team
          conversations exist, so the split is meaningless). */}
      {!isPersonal && (
        <div className="flex gap-1 px-3 pb-2">
          {tabs.map((tabItem) => (
            <button
              key={tabItem.key}
              type="button"
              onClick={() => setTab(tabItem.key)}
              className={`flex-1 cursor-pointer rounded-lg px-2 py-1.5 text-[12px] font-medium transition-colors ${
                tab === tabItem.key
                  ? "bg-primary-6 text-white"
                  : "bg-slate-100/60 text-slate-500 hover:bg-slate-100 hover:text-slate-900"
              }`}
            >
              {tabItem.label}
            </button>
          ))}
        </div>
      )}

      <ScrollArea className="flex-1">
        <div className="space-y-0.5 px-2 pb-4">
          {isLoading && (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
            </div>
          )}
          {!isLoading && filtered.length === 0 && (
            <div className="px-3 py-8 text-center">
              <MessageSquare className="mx-auto h-8 w-8 text-slate-300" />
              <p className="mt-2 text-xs text-slate-400">
                {query.trim() || tab !== "all"
                  ? t("chatHist.noMatches")
                  : t("chatHist.noConvos")}
              </p>
            </div>
          )}
          {filtered.map((convo) => {
            const isTeam = convo.scope === "team";
            const rawTitle = convo.title || t("chatHist.newConvo");
            const title =
              rawTitle.length > 28 ? rawTitle.slice(0, 28) + "..." : rawTitle;
            return (
              <div
                key={convo.id}
                role="button"
                tabIndex={0}
                onClick={() => onSelectConversation(convo.id)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onSelectConversation(convo.id);
                  }
                }}
                className={`group flex w-full cursor-pointer items-start gap-3 overflow-hidden rounded-lg px-3 py-3 text-left transition-colors hover:bg-slate-100/60 ${
                  activeConversationId === convo.id ? "bg-blue-50/50" : ""
                }`}
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="flex min-w-0 items-center gap-1.5 text-sm font-medium text-slate-900">
                      {/* Team marker — shared conversations get the
                          Users icon, mirroring the Figma chat list. */}
                      {isTeam && (
                        <Users className="h-3.5 w-3.5 shrink-0 text-primary-6" />
                      )}
                      <span className="truncate">{title}</span>
                    </span>
                    <span className="shrink-0 text-[11px] text-slate-400">
                      {getRelativeTime(convo.updatedAt)}
                    </span>
                  </div>
                  <div className="mt-1.5 flex items-center justify-between">
                    {/* Participant avatars */}
                    <div className="flex -space-x-1.5">
                      {convo.participants.slice(0, 3).map((p, i) => (
                        <Avatar
                          key={p.id || i}
                          className="h-5 w-5 border border-white"
                        >
                          {p.picture ? (
                            <AvatarImage src={p.picture} alt={p.name || ""} />
                          ) : null}
                          <AvatarFallback className="bg-slate-100 text-[9px] text-slate-600">
                            {getInitials(p.name)}
                          </AvatarFallback>
                        </Avatar>
                      ))}
                      {convo.participants.length > 3 && (
                        <span className="flex h-5 w-5 items-center justify-center rounded-full border border-white bg-slate-100 text-[9px] text-slate-500">
                          +{convo.participants.length - 3}
                        </span>
                      )}
                    </div>
                    {/* Delete button */}
                    <button
                      onClick={(e) => handleDelete(e, convo.id)}
                      className="shrink-0 text-slate-400 opacity-0 transition-opacity hover:text-red-500 group-hover:opacity-100"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </ScrollArea>
    </div>
  );
}
