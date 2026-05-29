"use client";

import { useState, useEffect } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createTeam, updateTeam, type Team } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { useLanguage } from "@/lib/i18n";

export function CreateTeamDialog({
  children,
  team,
}: {
  children: React.ReactNode;
  team?: Team;
}) {
  const { t } = useLanguage();
  const isEdit = !!team;
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [monthlyBudget, setMonthlyBudget] = useState("");

  const queryClient = useQueryClient();

  useEffect(() => {
    if (open && team) {
      setName(team.name);
      setDescription(team.description ?? "");
      setMonthlyBudget(
        team.monthlyBudgetCents ? String(team.monthlyBudgetCents / 100) : "",
      );
    } else if (!open) {
      setName("");
      setDescription("");
      setMonthlyBudget("");
    }
  }, [open, team]);

  const createMutation = useMutation({
    mutationFn: createTeam,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["teams"] });
      queryClient.invalidateQueries({ queryKey: ["org-users"] });
      setOpen(false);
    },
  });

  const updateMutation = useMutation({
    mutationFn: (data: { name?: string; description?: string }) =>
      updateTeam(team!.id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["teams"] });
      queryClient.invalidateQueries({ queryKey: ["org-users"] });
      setOpen(false);
    },
  });

  const isPending = createMutation.isPending || updateMutation.isPending;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;

    if (isEdit) {
      updateMutation.mutate({
        name: name.trim(),
        description: description.trim() || undefined,
      });
    } else {
      createMutation.mutate({
        name: name.trim(),
        description: description.trim() || undefined,
        monthlyBudget: monthlyBudget ? parseFloat(monthlyBudget) : undefined,
      });
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{isEdit ? t("dlg.team.editTitle") : t("dlg.team.createTitle")}</DialogTitle>
          <DialogDescription>
            {isEdit
              ? t("dlg.team.editDesc")
              : t("dlg.team.createDesc")}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="team-name">{t("dlg.team.name")}</Label>
            <Input
              id="team-name"
              placeholder={t("dlg.team.namePlaceholder")}
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="team-description">{t("dlg.team.desc")}</Label>
            <Textarea
              id="team-description"
              placeholder={t("dlg.team.descPlaceholder")}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
            />
          </div>
          {!isEdit && (
            <div className="space-y-2">
              <Label htmlFor="team-budget">{t("dlg.team.budget")}</Label>
              <Input
                id="team-budget"
                type="number"
                min="0"
                step="0.01"
                placeholder={t("dlg.team.budgetPlaceholder")}
                value={monthlyBudget}
                onChange={(e) => setMonthlyBudget(e.target.value)}
              />
            </div>
          )}
          <DialogFooter>
            <Button type="submit" disabled={isPending || !name.trim()}>
              {isPending
                ? isEdit
                  ? t("dlg.team.saving")
                  : t("dlg.team.creating")
                : isEdit
                  ? t("dlg.team.saveChanges")
                  : t("dlg.team.create")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
