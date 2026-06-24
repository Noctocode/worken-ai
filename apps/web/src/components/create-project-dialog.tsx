"use client";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { createProject, fetchTeams, DuplicateProjectNameError } from "@/lib/api";
import { useUserModels } from "@/lib/hooks/use-user-models";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { cloneElement, isValidElement, useEffect, useState } from "react";
import { useLanguage } from "@/lib/i18n";

export function CreateProjectDialog({
  children,
}: {
  children: React.ReactNode;
}) {
  const { t } = useLanguage();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [model, setModel] = useState("");
  const [teamId, setTeamId] = useState<string>("personal");
  // Set when the API rejects a duplicate name (409) on submit, cleared as
  // soon as the user edits the name again.
  const [nameTaken, setNameTaken] = useState(false);

  const queryClient = useQueryClient();
  // Only models enabled in the Models tab (effective list), so the
  // picker never offers a model the admin hasn't curated.
  const { models, isLoading: modelsLoading } = useUserModels();

  // Clear the form whenever the dialog closes, so reopening starts fresh
  // instead of showing the previous (cancelled) draft.
  useEffect(() => {
    if (!open) {
      setName("");
      setDescription("");
      setModel("");
      setTeamId("personal");
      setNameTaken(false);
    }
  }, [open]);

  const { data: teams } = useQuery({
    queryKey: ["teams"],
    queryFn: fetchTeams,
    enabled: open,
  });

  const mutation = useMutation({
    mutationFn: createProject,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["projects"] });
      // The close effect clears the form fields.
      setOpen(false);
    },
    onError: (err) => {
      if (err instanceof DuplicateProjectNameError) setNameTaken(true);
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !model) return;
    setNameTaken(false);
    mutation.mutate({
      name: name.trim(),
      description: description.trim() || undefined,
      model,
      teamId: teamId === "personal" ? undefined : teamId,
    });
  };

  // Instead of DialogTrigger (which renders aria-controls with random Radix IDs
  // causing hydration mismatch), we clone the child element with an onClick handler.
  const trigger = isValidElement(children)
    ? cloneElement(children as React.ReactElement<{ onClick?: () => void }>, {
        onClick: () => setOpen(true),
      })
    : children;

  return (
    <>
      {trigger}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("dlg.createProj.title")}</DialogTitle>
            <DialogDescription>
              {t("dlg.createProj.desc")}
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="project-name">{t("dlg.createProj.name")}</Label>
              <Input
                id="project-name"
                placeholder={t("dlg.createProj.namePlaceholder")}
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  setNameTaken(false);
                }}
                aria-invalid={nameTaken}
                className={nameTaken ? "border-danger-5" : undefined}
                required
              />
              {nameTaken && (
                <p className="text-[13px] text-danger-5">
                  {t("dlg.createProj.nameTaken")}
                </p>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="project-description">{t("dlg.createProj.description")}</Label>
              <Textarea
                id="project-description"
                placeholder={t("dlg.createProj.descPlaceholder")}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={3}
              />
            </div>
            <div className="space-y-2">
              <Label>{t("dlg.createProj.model")}</Label>
              <Select value={model} onValueChange={setModel} required>
                <SelectTrigger className="w-full">
                  <SelectValue
                    placeholder={
                      modelsLoading
                        ? t("dlg.createProj.modelsLoading")
                        : models.length === 0
                          ? t("dlg.createProj.noModels")
                          : t("dlg.createProj.selectModel")
                    }
                  />
                </SelectTrigger>
                <SelectContent>
                  {models.map((m) => (
                    <SelectItem key={m.id} value={m.id}>
                      {m.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {teams && teams.length > 0 && (
              <div className="space-y-2">
                <Label>{t("dlg.createProj.workspace")}</Label>
                <Select value={teamId} onValueChange={setTeamId}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="personal">{t("dlg.createProj.personal")}</SelectItem>
                    {teams.map((team) => (
                      <SelectItem key={team.id} value={team.id}>
                        {team.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <DialogFooter>
              <Button
                type="submit"
                disabled={mutation.isPending || !name.trim() || !model}
              >
                {mutation.isPending ? t("dlg.createProj.creating") : t("dlg.createProj.create")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}