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
import { createProject, fetchTeams } from "@/lib/api";
import { useAvailableModels } from "@/lib/hooks/use-available-models";
import { useUserModels } from "@/lib/hooks/use-user-models";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { cloneElement, isValidElement, useMemo, useState } from "react";
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

  const queryClient = useQueryClient();
  // Full OpenRouter catalog (WorkenAI-routed default). Drives the bulk
  // of the picker for users without their own keys.
  const { models: catalogModels, isLoading: modelsLoading } =
    useAvailableModels();
  // The user's own model_configs aliases — Custom LLM endpoints and BYOK
  // aliases. These live ONLY in /models/effective, never in the catalog,
  // so without merging them in a Custom LLM the user just registered
  // would be unpickable here and every project would fall back to an
  // OpenRouter model (which fails outright when the server has no
  // gateway key — the whole point of a self-hosted Custom LLM).
  const { effective } = useUserModels();
  const models = useMemo(() => {
    const aliases = effective.filter(
      (m) => m.source === "custom" || m.source === "alias",
    );
    const aliasIds = new Set(aliases.map((m) => m.id));
    // Aliases first (the user's own endpoints), then the catalog minus
    // any id an alias already covers.
    return [
      ...aliases.map((m) => ({ id: m.id, name: m.name })),
      ...catalogModels.filter((m) => !aliasIds.has(m.id)),
    ];
  }, [effective, catalogModels]);

  const { data: teams } = useQuery({
    queryKey: ["teams"],
    queryFn: fetchTeams,
    enabled: open,
  });

  const mutation = useMutation({
    mutationFn: createProject,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["projects"] });
      setName("");
      setDescription("");
      setModel("");
      setTeamId("personal");
      setOpen(false);
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !model) return;
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
                onChange={(e) => setName(e.target.value)}
                required
              />
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