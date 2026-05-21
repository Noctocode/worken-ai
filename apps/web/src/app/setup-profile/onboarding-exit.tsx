"use client";

import { useState } from "react";
import { LogOut, Trash2 } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { abortOnboarding, logout } from "@/lib/api";

/**
 * Escape-hatch control rendered in the `/setup-profile` layout. The
 * wizard has no sidebar (sidebar lives in `(app)` layout, hidden
 * during onboarding) — without these affordances a user who hit a
 * BE error or registered the wrong email had to clear cookies in
 * DevTools to escape.
 *
 * Two distinct actions:
 *   - Sign out: closes the session, preserves the user row + BE
 *     draft. They can return later and resume.
 *   - Cancel & delete account: hard reset. Wipes the user row + any
 *     orphaned tenant row, frees the email for re-registration.
 *     Gated behind a "type DELETE to confirm" input so an
 *     accidental click can't nuke a half-completed signup.
 */
export function OnboardingExit() {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const [signingOut, setSigningOut] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const onSignOut = async () => {
    if (signingOut) return;
    setSigningOut(true);
    try {
      await logout();
      // logout() already navigates to /login on success; fallback
      // in case anything stops the redirect.
      window.location.href = "/login";
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(msg || "Couldn't sign out. Try again.");
      setSigningOut(false);
    }
  };

  const onConfirmDelete = async () => {
    if (deleting) return;
    if (confirmText.trim().toUpperCase() !== "DELETE") return;
    setDeleting(true);
    try {
      await abortOnboarding();
      toast.success(
        "Account deleted. You can register again with the same email.",
      );
      // Hard navigation — server-side guards check the cleared
      // cookies on the next request, and any cached React Query
      // user state is dropped.
      window.location.href = "/register";
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(msg || "Couldn't delete your account. Try again.");
      setDeleting(false);
    }
  };

  return (
    <>
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={onSignOut}
          disabled={signingOut}
          className="inline-flex items-center gap-1.5 text-[13px] font-medium text-text-2 transition-colors hover:text-text-1 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <LogOut className="h-4 w-4" />
          Sign out
        </button>
        <span className="text-text-3 select-none">·</span>
        <button
          type="button"
          onClick={() => setConfirmOpen(true)}
          className="inline-flex items-center gap-1.5 text-[13px] font-medium text-danger-6 transition-colors hover:text-danger-7"
        >
          <Trash2 className="h-4 w-4" />
          Cancel &amp; delete account
        </button>
      </div>

      <Dialog
        open={confirmOpen}
        onOpenChange={(next) => {
          if (deleting) return;
          setConfirmOpen(next);
          if (!next) setConfirmText("");
        }}
      >
        <DialogContent className="sm:max-w-[440px]">
          <DialogHeader>
            <DialogTitle>Delete your account?</DialogTitle>
            <DialogDescription>
              This will permanently remove your user, any uploaded files, and —
              for a company profile that has no other members — the company
              tenant itself. Your email will be free to register again.
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-2 pt-2">
            <label
              htmlFor="onboarding-exit-confirm"
              className="text-[13px] font-medium text-text-2"
            >
              Type <span className="font-bold text-danger-6">DELETE</span> to
              confirm
            </label>
            <Input
              id="onboarding-exit-confirm"
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              placeholder="DELETE"
              autoFocus
              disabled={deleting}
            />
          </div>

          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => setConfirmOpen(false)}
              disabled={deleting}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={onConfirmDelete}
              disabled={
                deleting ||
                confirmText.trim().toUpperCase() !== "DELETE"
              }
            >
              {deleting ? "Deleting…" : "Delete account"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
