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

type Role = "admin" | "editor" | "viewer";

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
  const [role, setRole] = useState<Role>("viewer");
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
      setRole("viewer");
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
        <Select value={role} onValueChange={(v) => setRole(v as Role)}>
          <SelectTrigger id="invite-role" className="w-full border-border-3">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="admin">
              Admin — Owner-equivalent (manage budget, invites, roles)
            </SelectItem>
            <SelectItem value="editor">Editor — Can edit projects and content</SelectItem>
            <SelectItem value="viewer">
              Viewer — Read-only access
            </SelectItem>
          </SelectContent>
        </Select>
        {role === "admin" && (
          <p className="text-[11px] text-text-3">
            Only the team owner or an existing team admin can seed
            another admin. Editors trying to send this invite will
            see an error.
          </p>
        )}
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
