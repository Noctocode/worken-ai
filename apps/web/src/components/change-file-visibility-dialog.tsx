"use client";

import { useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import {
  fetchProjects,
  fetchScheduledPrompts,
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
import { useLanguage } from "@/lib/i18n";
import { useIsPersonal } from "@/lib/hooks/use-is-personal";

interface FileForVisibility {
  id: string;
  name: string;
  visibility: KnowledgeFileVisibility;
  teams: { id: string; name: string }[];
  projects: { id: string; name: string }[];
  schedules: { id: string; name: string }[];
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

// Base visibility tier (the broad access level). Team / project / schedule
// scopes are independent additive sets layered on top under "Specific".
type VisibilityBase = "all" | "admins" | "none";

/**
 * Post-upload visibility editor for a single KC file. UNION model: pick a
 * base tier (Everyone / Admins / Specific) and, under "Specific", any
 * combination of teams + projects + schedules at once — a file can be scoped
 * to a project AND a team simultaneously. Pre-fills from the file's current
 * state on every open.
 */
export function ChangeFileVisibilityDialog({
  file,
  open,
  onOpenChange,
  onSuccess,
  isAdmin,
}: ChangeFileVisibilityDialogProps) {
  const { t } = useLanguage();
  const isPersonal = useIsPersonal();
  const [base, setBase] = useState<VisibilityBase>("all");
  const [teamIds, setTeamIds] = useState<string[]>([]);
  const [projectIds, setProjectIds] = useState<string[]>([]);
  const [scheduleIds, setScheduleIds] = useState<string[]>([]);

  // Reset state every time the dialog opens for a new file. Map the stored
  // visibility to the base: 'all'/'admins' stay; any other value (legacy
  // single-scope, or 'none') becomes "Specific" so the scope panels show.
  useEffect(() => {
    if (!open || !file) return;
    setBase(
      file.visibility === "all"
        ? "all"
        : file.visibility === "admins"
          ? "admins"
          : "none",
    );
    setTeamIds(file.teams.map((t) => t.id));
    setProjectIds(file.projects.map((p) => p.id));
    setScheduleIds(file.schedules.map((s) => s.id));
  }, [open, file]);

  // Under "Specific" all three scope lists are needed at once.
  const scopesActive = open && base === "none";
  const { data: userTeams = [] } = useQuery({
    queryKey: ["teams"],
    queryFn: fetchTeams,
    enabled: scopesActive,
  });
  const { data: userProjects = [] } = useQuery({
    queryKey: ["projects", "kc-upload"],
    queryFn: () => fetchProjects("all"),
    enabled: scopesActive,
  });
  const { data: userSchedules = [] } = useQuery({
    queryKey: ["ai-cron", "visibility-picker"],
    queryFn: fetchScheduledPrompts,
    enabled: scopesActive,
  });

  const mutation = useMutation({
    mutationFn: () => {
      if (!file) throw new Error("Missing file");
      // Under a broad base, clear the scope sets; under "Specific", send the
      // chosen combination. The BE replaces each link set authoritatively.
      const specific = base === "none";
      return updateKnowledgeFileVisibility(
        file.id,
        base,
        specific ? teamIds : [],
        specific ? projectIds : [],
        specific ? scheduleIds : [],
      );
    },
    onSuccess: () => {
      toast.success(t("visDlg.updated"));
      onSuccess?.();
      onOpenChange(false);
    },
    onError: (err: Error) =>
      toast.error(err.message || t("visDlg.failedUpdate")),
  });

  const handleSave = () => {
    if (!file) return;
    if (
      base === "none" &&
      teamIds.length === 0 &&
      projectIds.length === 0 &&
      scheduleIds.length === 0
    ) {
      toast.error(t("visDlg.pickAtLeastScope"));
      return;
    }
    mutation.mutate();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("visDlg.title")}</DialogTitle>
          <DialogDescription className="truncate" title={file?.name}>
            {file?.name}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label>{t("visDlg.visibility")}</Label>
            <Select
              value={base}
              onValueChange={(v) => setBase(v as VisibilityBase)}
              disabled={mutation.isPending}
            >
              <SelectTrigger className="h-10 w-full cursor-pointer">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">
                  {isPersonal
                    ? t("knowledgeCore.visibilityOnlyMe")
                    : t("visDlg.everyone")}
                </SelectItem>
                {/* Company accounts only. 'admins' rendered even for a
                    non-admin (disabled) so the trigger label resolves for an
                    admin-set file; disabled blocks privilege escalation
                    (matches the BE gate). Personal accounts never have an
                    'admins' file and can't scope to teams/projects/schedules,
                    so they only get the "Only me" ('all') option above. */}
                {!isPersonal && (
                  <SelectItem value="admins" disabled={!isAdmin}>
                    {t("visDlg.adminsOnly")}
                    {!isAdmin ? t("visDlg.adminsOnlySuffix") : ""}
                  </SelectItem>
                )}
                {!isPersonal && (
                  <SelectItem value="none">{t("visDlg.specificScopes")}</SelectItem>
                )}
              </SelectContent>
            </Select>
            <p className="text-[11px] text-text-3">
              {isPersonal
                ? t("visDlg.hintOnlyMe")
                : base === "admins"
                  ? t("visDlg.hintAdmins")
                  : base === "none"
                    ? t("visDlg.hintSpecific")
                    : t("visDlg.hintEveryone")}
            </p>
          </div>

          {base === "none" && (
            <div className="space-y-2">
              <Label>{t("visDlg.teamsWithAccess")}</Label>
              {userTeams.length === 0 ? (
                <p className="text-[11px] text-text-3">
                  {t("visDlg.noTeams")}
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

          {base === "none" && (
            <div className="space-y-2">
              <Label>{t("visDlg.projectsWithAccess")}</Label>
              {userProjects.length === 0 ? (
                <p className="text-[11px] text-text-3">
                  {t("visDlg.noProjects")}
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

          {base === "none" && (
            <div className="space-y-2">
              <Label>{t("visDlg.schedulesWithAccess")}</Label>
              {userSchedules.length === 0 ? (
                <p className="text-[11px] text-text-3">
                  {t("visDlg.noSchedules")}
                </p>
              ) : (
                <div className="flex max-h-40 flex-col gap-1 overflow-y-auto rounded border border-border-3 p-2">
                  {userSchedules.map((s) => {
                    const checked = scheduleIds.includes(s.id);
                    return (
                      <label
                        key={s.id}
                        className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-[13px] text-text-1 hover:bg-bg-1"
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          disabled={mutation.isPending}
                          onChange={() =>
                            setScheduleIds((prev) =>
                              checked
                                ? prev.filter((id) => id !== s.id)
                                : [...prev, s.id],
                            )
                          }
                          className="h-3.5 w-3.5 cursor-pointer accent-primary-6"
                        />
                        <span className="truncate">{s.name}</span>
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
            {t("visDlg.cancel")}
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
                {t("visDlg.saving")}
              </>
            ) : (
              t("visDlg.save")
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
