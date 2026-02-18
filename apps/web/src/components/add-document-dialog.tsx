"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createDocument,
  fetchDocumentGroups,
  deleteDocumentGroup,
  type DocumentGroup,
} from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { FileText, Trash2, Loader2 } from "lucide-react";

interface AddDocumentDialogProps {
  projectId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function AddDocumentDialog({
  projectId,
  open,
  onOpenChange,
}: AddDocumentDialogProps) {
  const [content, setContent] = useState("");
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const { data: groups, isLoading: groupsLoading } = useQuery({
    queryKey: ["documentGroups", projectId],
    queryFn: () => fetchDocumentGroups(projectId),
    enabled: open,
  });

  const addMutation = useMutation({
    mutationFn: (text: string) => createDocument(projectId, text),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["documentGroups", projectId],
      });
      queryClient.invalidateQueries({ queryKey: ["documents", projectId] });
      setContent("");
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (groupId: string) => deleteDocumentGroup(projectId, groupId),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["documentGroups", projectId],
      });
      queryClient.invalidateQueries({ queryKey: ["documents", projectId] });
      setConfirmDeleteId(null);
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!content.trim()) return;
    addMutation.mutate(content.trim());
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Manage Context</DialogTitle>
          <DialogDescription>
            View existing context documents or add new ones. Text is chunked and
            embedded for semantic search in chat.
          </DialogDescription>
        </DialogHeader>

        {/* Add new context */}
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="document-content">Add New Context</Label>
            <Textarea
              id="document-content"
              placeholder="Paste your document text here..."
              value={content}
              onChange={(e) => setContent(e.target.value)}
              rows={6}
              className="resize-y"
              required
            />
          </div>
          <DialogFooter>
            <Button
              type="submit"
              disabled={addMutation.isPending || !content.trim()}
            >
              {addMutation.isPending ? "Adding..." : "Add Context"}
            </Button>
          </DialogFooter>
        </form>

        <Separator />

        {/* Existing document groups */}
        <div className="space-y-2">
          <Label className="text-sm font-medium">Documents</Label>
          <ScrollArea className="h-48">
            {groupsLoading ? (
              <div className="flex items-center justify-center py-6">
                <Loader2 className="h-4 w-4 animate-spin text-slate-400" />
              </div>
            ) : groups && groups.length > 0 ? (
              <div className="space-y-1">
                {groups.map((group: DocumentGroup) => (
                  <div
                    key={group.groupId}
                    className="flex items-center justify-between rounded-md border border-slate-200 px-3 py-2"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <FileText className="h-4 w-4 shrink-0 text-slate-400" />
                      <span className="truncate text-sm text-slate-700">
                        {group.title}
                      </span>
                      <Badge variant="secondary" className="shrink-0 text-xs">
                        {group.chunkCount}{" "}
                        {group.chunkCount === 1 ? "chunk" : "chunks"}
                      </Badge>
                    </div>
                    {confirmDeleteId === group.groupId ? (
                      <div className="flex items-center gap-1 shrink-0">
                        <Button
                          variant="destructive"
                          size="sm"
                          className="h-7 text-xs"
                          disabled={deleteMutation.isPending}
                          onClick={() => deleteMutation.mutate(group.groupId)}
                        >
                          {deleteMutation.isPending ? "..." : "Confirm"}
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 text-xs"
                          onClick={() => setConfirmDeleteId(null)}
                        >
                          Cancel
                        </Button>
                      </div>
                    ) : (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 shrink-0 text-slate-400 hover:text-red-500"
                        onClick={() => setConfirmDeleteId(group.groupId)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <p className="py-4 text-center text-sm text-slate-400">
                No documents added yet.
              </p>
            )}
          </ScrollArea>
        </div>
      </DialogContent>
    </Dialog>
  );
}
