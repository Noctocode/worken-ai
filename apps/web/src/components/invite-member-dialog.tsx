"use client";

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { TeamInviteForm } from "@/components/team-invite-form";

export function InviteMemberDialog({
  teamId,
  children,
}: {
  teamId: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Invite Member</DialogTitle>
          <DialogDescription>
            Invited users will auto-join when they sign in with Google.
          </DialogDescription>
        </DialogHeader>
        <TeamInviteForm
          mode={{ kind: "fixed", teamId }}
          submitLabel="Invite Member"
          onSuccess={() => setOpen(false)}
        />
        <DialogFooter />
      </DialogContent>
    </Dialog>
  );
}
