"use client";

import { useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import {
  fetchProjects,
  fetchTeams,
  updateKnowledgeFileVisibility,
  type KnowledgeFileVisibility,
} from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
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

interface FileForVisibility {
  id: string;
  name: string;
  visibility: KnowledgeFileVisibility;
  teams: { id: string; name: string }[];
  projects: { id: string; name: string }[];
}

interface ChangeFileVisibilityDialogProps {
  file: FileForVisibility | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Fires after a successful PATCH so caller can refresh its queries. */
  onSuccess?: () => void;
  /** Admin-only role gate — the BE rejects non-admin callers too,
   *  but FE-side hiding is cleaner UX. */
  isAdmin: boolean;
}

/**
 * Post-upload visibility editor for a single KC file. Covers all
 * four tiers (all / admins / teams / project) symmetrically with the
 * upload-time picker, including the multi-select pickers for teams
 * and projects. Pre-fills from the file's current state on every
 * open so the user starts from where they left off.
 */
export function ChangeFileVisibilityDialog({
  file,
  open,
  onOpenChange,
  onSuccess,
  isAdmin,
}: ChangeFileVisibilityDialogProps) {
  const [visibility, setVisibility] =
    useState<KnowledgeFileVisibility>("all");
  const [teamIds, setTeamIds] = useState<string[]>([]);
  const [projectIds, setProjectIds] = useState<string[]>([]);

  // Reset state every time the dialog opens for a new file. Without
  // this the picker remembers the prior file's selection across
  // openings, which is misleading.
  useEffect(() => {
    if (!open || !file) return;
    setVisibility(file.visibility);
    setTeamIds(file.teams.map((t) => t.id));
    setProjectIds(file.projects.map((p) => p.id));
  }, [open, file]);

  // Lazy-fetch the picker data — only when the dialog is open AND
  // the matching visibility branch is active, so closing the dialog
  // (or picking 'all'/'admins') doesn't burn round-trips.
  const { data: userTeams = [] } = useQuery({
    queryKey: ["teams"],
    queryFn: fetchTeams,
    enabled: open && visibility === "teams",
  });
  const { data: userProjects = [] } = useQuery({
    queryKey: ["projects", "kc-upload"],
    queryFn: () => fetchProjects("all"),
    enabled: open && visibility === "project",
  });

  const mutation = useMutation({
    mutationFn: () => {
      if (!file) throw new Error("Missing file");
      return updateKnowledgeFileVisibility(
        file.id,
        visibility,
        teamIds,
        projectIds,
      );
    },
    onSuccess: () => {
      toast.success("Visibility updated.");
      onSuccess?.();
      onOpenChange(false);
    },
    onError: (err: Error) =>
      toast.error(err.message || "Failed to update visibility."),
  });

  const handleSave = () => {
    if (!file) return;
    if (visibility === "teams" && teamIds.length === 0) {
      toast.error("Pick at least one team for Teams visibility.");
      return;
    }
    if (visibility === "project" && projectIds.length === 0) {
      toast.error("Pick at least one project for Project visibility.");
      return;
    }
    mutation.mutate();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Change visibility</DialogTitle>
          <DialogDescription className="truncate" title={file?.name}>
            {file?.name}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Visibility</Label>
            <Select
              value={visibility}
              onValueChange={(v) =>
                setVisibility(v as KnowledgeFileVisibility)
              }
              disabled={mutation.isPending}
            >
              <SelectTrigger className="h-10 w-full cursor-pointer">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Everyone in the company</SelectItem>
                {isAdmin && (
                  <SelectItem value="admins">Admins only</SelectItem>
                )}
                <SelectItem value="teams">Specific teams…</SelectItem>
                <SelectItem value="project">Specific project…</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-[11px] text-text-3">
              {visibility === "admins"
                ? "Only admins will see this file in chat / arena."
                : visibility === "teams"
                  ? "Only members of the teams you pick below will see this file."
                  : visibility === "project"
                    ? "This file will only appear in the chat of the project(s) you pick below — never in the org-wide RAG."
                    : "Every user in the company can see this file in chat / arena."}
            </p>
          </div>

          {visibility === "teams" && (
            <div className="space-y-2">
              <Label>Teams with access</Label>
              {userTeams.length === 0 ? (
                <p className="text-[11px] text-text-3">
                  You aren&rsquo;t a member of any team yet — create or
                  join a team first to use this visibility option.
                </p>
              ) : (
                <div className="flex max-h-40 flex-col gap-1 overflow-y-auto rounded border border-border-3 p-2">
                  {userTeams.map((t) => {
                    const checked = teamIds.includes(t.id);
                    return (
                      <label
                        key={t.id}
                        className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-[13px] text-text-1 hover:bg-bg-1"
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          disabled={mutation.isPending}
                          onChange={() =>
                            setTeamIds((prev) =>
                              checked
                                ? prev.filter((id) => id !== t.id)
                                : [...prev, t.id],
                            )
                          }
                          className="h-3.5 w-3.5 cursor-pointer accent-primary-6"
                        />
                        <span className="truncate">{t.name}</span>
                      </label>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {visibility === "project" && (
            <div className="space-y-2">
              <Label>Projects with access</Label>
              {userProjects.length === 0 ? (
                <p className="text-[11px] text-text-3">
                  You don&rsquo;t have access to any projects yet — create
                  one first to use this visibility option.
                </p>
              ) : (
                <div className="flex max-h-40 flex-col gap-1 overflow-y-auto rounded border border-border-3 p-2">
                  {userProjects.map((p) => {
                    const checked = projectIds.includes(p.id);
                    return (
                      <label
                        key={p.id}
                        className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-[13px] text-text-1 hover:bg-bg-1"
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          disabled={mutation.isPending}
                          onChange={() =>
                            setProjectIds((prev) =>
                              checked
                                ? prev.filter((id) => id !== p.id)
                                : [...prev, p.id],
                            )
                          }
                          className="h-3.5 w-3.5 cursor-pointer accent-primary-6"
                        />
                        <span className="truncate">
                          {p.name}
                          {p.teamName ? (
                            <span className="ml-1 text-text-3">
                              · {p.teamName}
                            </span>
                          ) : null}
                        </span>
                      </label>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={mutation.isPending}
            className="cursor-pointer"
          >
            Cancel
          </Button>
          <Button
            type="button"
            onClick={handleSave}
            disabled={mutation.isPending || !file}
            className="cursor-pointer bg-primary-6 hover:bg-primary-7"
          >
            {mutation.isPending ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Saving…
              </>
            ) : (
              "Save"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
