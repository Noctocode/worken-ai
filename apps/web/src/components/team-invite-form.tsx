"use client";

import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { fetchTeams, inviteTeamMember } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type Role = "basic" | "advanced";

type Mode =
  | { kind: "fixed"; teamId: string }
  | { kind: "select" };

interface TeamInviteFormProps {
  mode: Mode;
  submitLabel?: string;
  onSuccess?: () => void;
}

export function TeamInviteForm({
  mode,
  submitLabel = "Send Invite",
  onSuccess,
}: TeamInviteFormProps) {
  const [email, setEmail] = useState("");
  // TODO: temporary 2026-04-13 — all users get advanced until permissions are finalized.
  // Revert by changing the default back to "basic" and removing the `disabled` + helper text below.
  const [role, setRole] = useState<Role>("advanced");
  const [selectedTeamId, setSelectedTeamId] = useState<string>(
    mode.kind === "fixed" ? mode.teamId : "",
  );

  const qc = useQueryClient();

  const teamsQuery = useQuery({
    queryKey: ["teams"],
    queryFn: fetchTeams,
    enabled: mode.kind === "select",
  });

  // Auto-select when there's only one team to invite into.
  useEffect(() => {
    if (
      mode.kind === "select" &&
      !selectedTeamId &&
      teamsQuery.data &&
      teamsQuery.data.length === 1
    ) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSelectedTeamId(teamsQuery.data[0].id);
    }
  }, [mode.kind, selectedTeamId, teamsQuery.data]);

  const mutation = useMutation({
    mutationFn: () => inviteTeamMember(selectedTeamId, email.trim(), role),
    onSuccess: (data) => {
      toast.success(
        `${data.resent ? "Invitation resent" : "Invitation sent"} to ${email.trim()}`,
      );
      qc.invalidateQueries({ queryKey: ["teams"] });
      qc.invalidateQueries({ queryKey: ["teams", selectedTeamId] });
      qc.invalidateQueries({ queryKey: ["org-users"] });
      qc.invalidateQueries({ queryKey: ["team-invitations", selectedTeamId] });
      setEmail("");
      setRole("basic");
      if (mode.kind === "select") setSelectedTeamId("");
      onSuccess?.();
    },
    onError: (err: Error) => {
      toast.error(err.message || "Failed to send invitation");
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !selectedTeamId) return;
    mutation.mutate();
  };

  // Empty state: org-level dialog with no teams in the workspace yet.
  if (mode.kind === "select" && teamsQuery.data && teamsQuery.data.length === 0) {
    return (
      <div className="space-y-4">
        <p className="text-sm text-text-2">
          Create a team first before inviting users.
        </p>
        <Button type="button" disabled className="w-full">
          {submitLabel}
        </Button>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {mode.kind === "select" && (
        <div className="space-y-2">
          <Label htmlFor="invite-team">Team</Label>
          <Select
            value={selectedTeamId}
            onValueChange={setSelectedTeamId}
            disabled={teamsQuery.isLoading}
          >
            <SelectTrigger id="invite-team" className="w-full border-border-3">
              <SelectValue
                placeholder={
                  teamsQuery.isLoading ? "Loading teams..." : "Select a team"
                }
              />
            </SelectTrigger>
            <SelectContent>
              {(teamsQuery.data ?? []).map((t) => (
                <SelectItem key={t.id} value={t.id}>
                  {t.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      <div className="space-y-2">
        <Label htmlFor="invite-email">Email</Label>
        <Input
          id="invite-email"
          type="email"
          placeholder="user@example.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          className="border-border-3"
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="invite-role">Role</Label>
        {/* TODO: temporary 2026-04-13 — all users get advanced until permissions are finalized.
            Revert by removing `disabled` and the helper text below. */}
        <Select
          value={role}
          onValueChange={(v) => setRole(v as Role)}
          disabled
        >
          <SelectTrigger id="invite-role" className="w-full border-border-3">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="basic">Basic — View team projects</SelectItem>
            <SelectItem value="advanced">
              Advanced — Can create projects
            </SelectItem>
          </SelectContent>
        </Select>
        <p className="text-xs text-text-3">
          All new users get Advanced access for now.
        </p>
      </div>

      <Button
        type="submit"
        disabled={mutation.isPending || !email.trim() || !selectedTeamId}
        className="w-full"
      >
        {mutation.isPending ? "Sending..." : submitLabel}
      </Button>
    </form>
  );
}
