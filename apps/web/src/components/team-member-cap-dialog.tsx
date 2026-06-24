"use client";

import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { updateTeamMemberCap, type TeamMember } from "@/lib/api";
import { useLanguage } from "@/lib/i18n";

interface TeamMemberCapDialogProps {
  teamId: string;
  member: TeamMember;
  open: boolean;
  onClose: () => void;
}

/**
 * Per-member spend cap editor. Three end states:
 *   • Set a positive cap (e.g. $20/month)
 *   • Clear the cap (member shares team budget freely → null)
 *   • Suspend (cap=0 → chat-time gate blocks every call)
 */
export function TeamMemberCapDialog({
  teamId,
  member,
  open,
  onClose,
}: TeamMemberCapDialogProps) {
  const { t } = useLanguage();
  const queryClient = useQueryClient();
  const initialUsd =
    member.monthlyCapCents != null && member.monthlyCapCents > 0
      ? (member.monthlyCapCents / 100).toString()
      : "";
  const [capUsd, setCapUsd] = useState(initialUsd);

  // Re-seed the input from the member every time the dialog opens, so it never
  // shows a value typed for a previous member or a previous (cancelled) edit.
  useEffect(() => {
    if (open) setCapUsd(initialUsd);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, member.id]);

  const mutation = useMutation({
    mutationFn: (cents: number | null) =>
      updateTeamMemberCap(teamId, member.id, cents),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["teams", teamId] });
      onClose();
    },
    onError: (err: Error) =>
      toast.error(err.message ?? t("memberCap.failed")),
  });

  const handleSetCap = () => {
    const num = parseFloat(capUsd.replace(",", "."));
    if (isNaN(num) || num <= 0) {
      toast.error(t("memberCap.positiveOrClear"));
      return;
    }
    mutation.mutate(Math.round(num * 100));
  };

  const memberLabel = member.userName ?? member.email;
  const currentLabel =
    member.monthlyCapCents == null
      ? t("memberCap.noCap")
      : member.monthlyCapCents === 0
        ? t("memberCap.suspended")
        : `$${(member.monthlyCapCents / 100).toFixed(2)}${t("memberCap.perMonth")}`;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("memberCap.title")} {memberLabel}</DialogTitle>
          <DialogDescription>
            {t("memberCap.desc")}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="rounded-md border border-border-2 bg-bg-1 px-3 py-2 text-[13px] text-text-2">
            {t("memberCap.current")} <strong className="text-text-1">{currentLabel}</strong>
          </div>

          <div className="space-y-2">
            <Label htmlFor="member-cap-input">{t("memberCap.label")}</Label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[14px] text-text-3">
                $
              </span>
              <Input
                id="member-cap-input"
                type="number"
                min="0"
                step="0.01"
                value={capUsd}
                onChange={(e) => setCapUsd(e.target.value)}
                placeholder="20.00"
                className="pl-7"
              />
            </div>
            <p className="text-[12px] text-text-3">
              {t("memberCap.hint")}
            </p>
          </div>
        </div>

        <DialogFooter className="gap-2 sm:gap-2 flex-col sm:flex-row">
          <Button
            type="button"
            variant="outline"
            onClick={() => mutation.mutate(null)}
            disabled={mutation.isPending}
          >
            {t("memberCap.clearCap")}
          </Button>
          <Button
            type="button"
            variant="destructive"
            onClick={() => mutation.mutate(0)}
            disabled={mutation.isPending}
          >
            {t("memberCap.suspend")}
          </Button>
          <Button
            type="button"
            onClick={handleSetCap}
            disabled={mutation.isPending}
          >
            {mutation.isPending ? t("memberCap.saving") : t("memberCap.setCap")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
