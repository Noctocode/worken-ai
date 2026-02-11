"use client";

import { useQuery } from "@tanstack/react-query";
import { Plus, MessageSquare, Loader2, Trash2 } from "lucide-react";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  fetchConversations,
  deleteConversation,
  type ConversationListItem,
} from "@/lib/api";
import { useQueryClient } from "@tanstack/react-query";

interface ChatHistorySidebarProps {
  projectId: string;
  activeConversationId: string | null;
  onSelectConversation: (id: string) => void;
  onNewChat: () => void;
}

function getRelativeTime(dateStr: string) {
  const now = Date.now();
  const date = new Date(dateStr).getTime();
  const diff = now - date;
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
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
  const queryClient = useQueryClient();

  const { data: conversations, isLoading } = useQuery({
    queryKey: ["conversations", projectId],
    queryFn: () => fetchConversations(projectId),
  });

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

  return (
    <div className="hidden w-72 shrink-0 flex-col border-r border-slate-200/60 lg:flex">
      <div className="flex h-14 shrink-0 items-center justify-between px-4">
        <h2 className="text-sm font-semibold text-slate-900">Chat History</h2>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 text-slate-500 hover:text-slate-900"
          onClick={onNewChat}
        >
          <Plus className="h-4 w-4" />
        </Button>
      </div>
      <ScrollArea className="flex-1">
        <div className="space-y-0.5 px-2 pb-4">
          {isLoading && (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
            </div>
          )}
          {!isLoading && (!conversations || conversations.length === 0) && (
            <div className="px-3 py-8 text-center">
              <MessageSquare className="mx-auto h-8 w-8 text-slate-300" />
              <p className="mt-2 text-xs text-slate-400">No conversations yet</p>
            </div>
          )}
          {conversations?.map((convo) => (
            <button
              key={convo.id}
              onClick={() => onSelectConversation(convo.id)}
              className={`group flex w-full items-start gap-3 rounded-lg px-3 py-3 text-left transition-colors hover:bg-slate-100/60 ${
                activeConversationId === convo.id ? "bg-blue-50/50" : ""
              }`}
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-sm font-medium text-slate-900">
                    {convo.title || "New conversation"}
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
                    className="hidden text-slate-400 hover:text-red-500 group-hover:block"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            </button>
          ))}
        </div>
      </ScrollArea>
    </div>
  );
}
