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

export function InviteUserDialog({
  children,
}: {
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Invite User</DialogTitle>
          <DialogDescription>
            Pick a team and role — they’ll join automatically when they accept the invitation.
          </DialogDescription>
        </DialogHeader>
        <TeamInviteForm
          mode={{ kind: "select" }}
          submitLabel="Invite User"
          onSuccess={() => setOpen(false)}
        />
        <DialogFooter />
      </DialogContent>
    </Dialog>
  );
}
