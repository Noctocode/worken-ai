"use client";

import { useState } from "react";
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
  const queryClient = useQueryClient();
  const initialUsd =
    member.monthlyCapCents != null && member.monthlyCapCents > 0
      ? (member.monthlyCapCents / 100).toString()
      : "";
  const [capUsd, setCapUsd] = useState(initialUsd);

  const mutation = useMutation({
    mutationFn: (cents: number | null) =>
      updateTeamMemberCap(teamId, member.id, cents),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["teams", teamId] });
      onClose();
    },
    onError: (err: Error) =>
      toast.error(err.message ?? "Couldn't update member cap."),
  });

  const handleSetCap = () => {
    const num = parseFloat(capUsd.replace(",", "."));
    if (isNaN(num) || num <= 0) {
      toast.error("Enter a positive amount, or use Clear / Suspend.");
      return;
    }
    mutation.mutate(Math.round(num * 100));
  };

  const memberLabel = member.userName ?? member.email;
  const currentLabel =
    member.monthlyCapCents == null
      ? "No cap (shares team budget)"
      : member.monthlyCapCents === 0
        ? "Suspended (chat blocked)"
        : `$${(member.monthlyCapCents / 100).toFixed(2)}/month`;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Monthly cap for {memberLabel}</DialogTitle>
          <DialogDescription>
            Cap this member&rsquo;s monthly spend inside this team. The
            limit is enforced against their successful chat calls billed
            through the team key (WorkenAI default or team-shared BYOK).
            Resets on the 1st.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="rounded-md border border-border-2 bg-bg-1 px-3 py-2 text-[13px] text-text-2">
            Current: <strong className="text-text-1">{currentLabel}</strong>
          </div>

          <div className="space-y-2">
            <Label htmlFor="member-cap-input">Monthly cap (USD)</Label>
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
              Use the buttons below to clear the cap (no per-user limit)
              or suspend the member entirely.
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
            Clear cap
          </Button>
          <Button
            type="button"
            variant="destructive"
            onClick={() => mutation.mutate(0)}
            disabled={mutation.isPending}
          >
            Suspend
          </Button>
          <Button
            type="button"
            onClick={handleSetCap}
            disabled={mutation.isPending}
          >
            {mutation.isPending ? "Saving…" : "Set cap"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
