"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { inviteUser, inviteTeamMember, type OrgRole } from "@/lib/api";
import { useAuth } from "@/components/providers";
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
import { useLanguage } from "@/lib/i18n";
import { useResetOnClose } from "@/lib/hooks/use-reset-on-close";

type TeamRole = "admin" | "manager" | "editor" | "viewer";

function TeamInviteDialog({
  children,
  teamId,
}: {
  children: React.ReactNode;
  teamId: string;
}) {
  const { t } = useLanguage();
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<TeamRole>("viewer");
  // Free-form text so we can keep the field empty (= no cap, shares
  // team budget) without having to pick between 0 and undefined.
  const [capUsd, setCapUsd] = useState("");
  const [capError, setCapError] = useState<string | null>(null);
  const qc = useQueryClient();

  // Clear the form whenever the dialog closes, so reopening starts fresh.
  useResetOnClose(open, () => {
    setEmail("");
    setRole("viewer");
    setCapUsd("");
    setCapError(null);
  });

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
          ? `${t("dlg.invite.resent")} ${data.email}.`
          : `${t("dlg.invite.invitedAs1")} ${data.email} ${t("dlg.invite.invitedAs2")} ${data.role}.`,
      );
      qc.invalidateQueries({ queryKey: ["teams", teamId] });
      setEmail("");
      setRole("viewer");
      setCapUsd("");
      setCapError(null);
      setOpen(false);
    },
    onError: (err: Error) => {
      toast.error(err.message || t("dlg.invite.failedMember"));
    },
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("dlg.invite.memberTitle")}</DialogTitle>
          <DialogDescription>{t("dlg.invite.memberDesc")}</DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!email.trim()) return;
            const parsed = parseCapToCents();
            if (parsed === "invalid") {
              setCapError(t("dlg.invite.capError"));
              return;
            }
            setCapError(null);
            mutation.mutate();
          }}
          className="space-y-4"
        >
          <div className="space-y-2">
            <Label htmlFor="invite-email">{t("dlg.invite.email")}</Label>
            <Input
              id="invite-email"
              type="email"
              placeholder={t("dlg.invite.emailPlaceholder")}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="invite-role">{t("dlg.invite.role")}</Label>
            <Select value={role} onValueChange={(v) => setRole(v as TeamRole)}>
              <SelectTrigger id="invite-role" className="w-full cursor-pointer">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="admin">
                  {t("dlg.invite.role.admin")}
                </SelectItem>
                <SelectItem value="manager">
                  {t("dlg.invite.role.manager")}
                </SelectItem>
                <SelectItem value="editor">
                  {t("dlg.invite.role.editor")}
                </SelectItem>
                <SelectItem value="viewer">
                  {t("dlg.invite.role.viewer")}
                </SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="invite-cap">{t("dlg.invite.cap")}</Label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[14px] text-text-3">
                $
              </span>
              <Input
                id="invite-cap"
                type="number"
                min="0"
                step="0.01"
                placeholder={t("dlg.invite.capPlaceholder")}
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
                {t("dlg.invite.capDesc1")}<strong>0</strong>{t("dlg.invite.capDesc2")}
              </p>
            )}
          </div>
          <DialogFooter>
            <Button
              type="submit"
              disabled={mutation.isPending || !email.trim()}
              className="cursor-pointer bg-primary-6 hover:bg-primary-7"
            >
              {mutation.isPending ? t("dlg.invite.inviting") : t("dlg.invite.inviteMember")}
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
  const { t } = useLanguage();
  const { user } = useAuth();
  // Admin-only invite-as-admin matches the BE gate in
  // users.controller.ts#inviteUser. Hiding the option for advanced
  // users avoids surfacing a button that 403s on submit.
  const canInviteAdmin = user?.role === "admin";
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<OrgRole>("basic");
  const qc = useQueryClient();

  // Clear the form whenever the dialog closes, so reopening starts fresh.
  useResetOnClose(open, () => {
    setEmail("");
    setRole("basic");
  });

  const mutation = useMutation({
    mutationFn: () => inviteUser(email.trim(), role),
    onSuccess: (data) => {
      toast.success(
        data.status === "updated"
          ? `${t("dlg.invite.updated")} ${data.email} ${t("dlg.invite.invitedAs2")} ${data.role}.`
          : `${t("dlg.invite.invitedAs1")} ${data.email} ${t("dlg.invite.invitedAs2")} ${data.role}.`,
      );
      qc.invalidateQueries({ queryKey: ["org-users"] });
      setEmail("");
      setRole("basic");
      setOpen(false);
    },
    onError: (err: Error) => {
      toast.error(err.message || t("dlg.invite.failedUser"));
    },
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("dlg.invite.userTitle")}</DialogTitle>
          <DialogDescription>{t("dlg.invite.userDesc")}</DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (email.trim()) mutation.mutate();
          }}
          className="space-y-4"
        >
          <div className="space-y-2">
            <Label htmlFor="invite-email">{t("dlg.invite.email")}</Label>
            <Input
              id="invite-email"
              type="email"
              placeholder={t("dlg.invite.emailPlaceholder")}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="invite-role">{t("dlg.invite.role")}</Label>
            <Select value={role} onValueChange={(v) => setRole(v as OrgRole)}>
              <SelectTrigger id="invite-role" className="w-full cursor-pointer">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="basic">
                  {t("dlg.invite.org.basic")}
                </SelectItem>
                <SelectItem value="advanced">
                  {t("dlg.invite.org.advanced")}
                </SelectItem>
                {canInviteAdmin && (
                  <SelectItem value="admin">
                    {t("dlg.invite.org.admin")}
                  </SelectItem>
                )}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button
              type="submit"
              disabled={mutation.isPending || !email.trim()}
              className="cursor-pointer bg-primary-6 hover:bg-primary-7"
            >
              {mutation.isPending ? t("dlg.invite.inviting") : t("dlg.invite.inviteUser")}
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
