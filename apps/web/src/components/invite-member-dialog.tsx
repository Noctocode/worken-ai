"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { inviteUser } from "@/lib/api";
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

export function InviteMemberDialog({
  children,
}: {
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"basic" | "advanced">("basic");
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
          <DialogDescription>
            Add a user to the organization.
          </DialogDescription>
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
            <Select
              value={role}
              onValueChange={(v) => setRole(v as "basic" | "advanced")}
            >
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
