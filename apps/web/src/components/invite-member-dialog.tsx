"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { inviteUser, inviteTeamMember } from "@/lib/api";
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
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type TeamRole = "admin" | "manager" | "editor" | "viewer";
type OrgRole = "basic" | "advanced";

function TeamInviteDialog({
  children,
  teamId,
}: {
  children: React.ReactNode;
  teamId: string;
}) {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<TeamRole>("viewer");
  // Free-form text so we can keep the field empty (= no cap, shares
  // team budget) without having to pick between 0 and undefined.
  const [capUsd, setCapUsd] = useState("");
  const [capError, setCapError] = useState<string | null>(null);
  const qc = useQueryClient();

  const parseCapToCents = (): number | null | "invalid" => {
    const trimmed = capUsd.trim();
    if (!trimmed) return null;
    const num = parseFloat(trimmed.replace(",", "."));
    if (!Number.isFinite(num) || num < 0) return "invalid";
    return Math.round(num * 100);
  };

  const mutation = useMutation({
    mutationFn: () => {
      const parsed = parseCapToCents();
      // The submit handler already gates on validity; re-checking
      // here keeps TS happy and is a cheap safety net.
      const capCents = parsed === "invalid" ? null : parsed;
      return inviteTeamMember(teamId, email.trim(), role, capCents);
    },
    onSuccess: (data) => {
      toast.success(
        data.resent
          ? `Invitation resent to ${data.email}.`
          : `Invited ${data.email} as ${data.role}.`,
      );
      qc.invalidateQueries({ queryKey: ["teams", teamId] });
      setEmail("");
      setRole("viewer");
      setCapUsd("");
      setCapError(null);
      setOpen(false);
    },
    onError: (err: Error) => {
      toast.error(err.message || "Failed to invite member.");
    },
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Invite Member</DialogTitle>
          <DialogDescription>Add a member to this team.</DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!email.trim()) return;
            const parsed = parseCapToCents();
            if (parsed === "invalid") {
              setCapError(
                "Enter a non-negative number, or leave blank for no cap.",
              );
              return;
            }
            setCapError(null);
            mutation.mutate();
          }}
          className="space-y-4"
        >
          <div className="space-y-2">
            <Label htmlFor="invite-email">Email</Label>
            <Input
              id="invite-email"
              type="email"
              placeholder="user@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="invite-role">Role</Label>
            <Select value={role} onValueChange={(v) => setRole(v as TeamRole)}>
              <SelectTrigger id="invite-role" className="w-full cursor-pointer">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="admin">
                  Admin — Full team management rights
                </SelectItem>
                <SelectItem value="manager">
                  Manager — Manage members, budgets and integrations
                </SelectItem>
                <SelectItem value="editor">
                  Editor — Can edit projects and content
                </SelectItem>
                <SelectItem value="viewer">
                  Viewer — Read-only access
                </SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="invite-cap">Monthly cap (optional)</Label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[14px] text-text-3">
                $
              </span>
              <Input
                id="invite-cap"
                type="number"
                min="0"
                step="0.01"
                placeholder="Leave blank for no cap"
                value={capUsd}
                onChange={(e) => {
                  setCapUsd(e.target.value);
                  if (capError) setCapError(null);
                }}
                className="pl-7"
              />
            </div>
            {capError ? (
              <p className="text-[12px] text-danger-6">{capError}</p>
            ) : (
              <p className="text-[12px] text-text-3">
                Caps this member&rsquo;s monthly spend inside the team.
                Leave blank to share the team&rsquo;s overall budget.
                Enter <strong>0</strong> to invite as suspended.
              </p>
            )}
          </div>
          <DialogFooter>
            <Button
              type="submit"
              disabled={mutation.isPending || !email.trim()}
              className="cursor-pointer bg-primary-6 hover:bg-primary-7"
            >
              {mutation.isPending ? "Inviting..." : "Invite Member"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function OrgInviteDialog({
  children,
}: {
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<OrgRole>("basic");
  const qc = useQueryClient();

  const mutation = useMutation({
    mutationFn: () => inviteUser(email.trim(), role),
    onSuccess: (data) => {
      toast.success(
        data.status === "updated"
          ? `Updated ${data.email} to ${data.role}.`
          : `Invited ${data.email} as ${data.role}.`,
      );
      qc.invalidateQueries({ queryKey: ["org-users"] });
      setEmail("");
      setRole("basic");
      setOpen(false);
    },
    onError: (err: Error) => {
      toast.error(err.message || "Failed to invite user.");
    },
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Invite User</DialogTitle>
          <DialogDescription>Add a user to the organization.</DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (email.trim()) mutation.mutate();
          }}
          className="space-y-4"
        >
          <div className="space-y-2">
            <Label htmlFor="invite-email">Email</Label>
            <Input
              id="invite-email"
              type="email"
              placeholder="user@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="invite-role">Role</Label>
            <Select value={role} onValueChange={(v) => setRole(v as OrgRole)}>
              <SelectTrigger id="invite-role" className="w-full cursor-pointer">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="basic">
                  Basic — View projects and teams
                </SelectItem>
                <SelectItem value="advanced">
                  Advanced — Full access to management
                </SelectItem>
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button
              type="submit"
              disabled={mutation.isPending || !email.trim()}
              className="cursor-pointer bg-primary-6 hover:bg-primary-7"
            >
              {mutation.isPending ? "Inviting..." : "Invite User"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function InviteMemberDialog({
  children,
  teamId,
}: {
  children: React.ReactNode;
  teamId?: string;
}) {
  return teamId ? (
    <TeamInviteDialog teamId={teamId}>{children}</TeamInviteDialog>
  ) : (
    <OrgInviteDialog>{children}</OrgInviteDialog>
  );
}
