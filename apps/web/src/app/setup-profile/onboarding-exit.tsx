"use client";

import { useState } from "react";
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
import { useLanguage } from "@/lib/i18n";

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
 *
 * `allowCancel` defaults to true. Pass false on the post-submit
 * "Setting up your AI…" / "Your AI is ready" screen — the BE has
 * already stamped onboardingCompletedAt, so /onboarding/abort
 * would 400 there and the Cancel button is just a footgun. Sign
 * out still works on that screen, so the row stays visible.
 */
export function OnboardingExit({
  allowCancel = true,
}: {
  allowCancel?: boolean;
} = {}) {
  const { t } = useLanguage();
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
      <div className="flex items-center gap-3 text-[13px] text-text-1">
        <button
          type="button"
          onClick={onSignOut}
          disabled={signingOut}
          className="cursor-pointer font-medium no-underline hover:no-underline disabled:cursor-not-allowed disabled:opacity-50"
        >
          {t("onboarding.exit.signOut")}
        </button>
        {allowCancel ? (
          <>
            {/* Thin vertical separator so the two links read as a single
                inline pair rather than two stacked actions. */}
            <span
              aria-hidden="true"
              className="h-3.5 w-px bg-text-1 select-none"
            />
            <button
              type="button"
              onClick={() => setConfirmOpen(true)}
              className="cursor-pointer font-medium no-underline hover:no-underline"
            >
              {t("onboarding.exit.cancel")}
            </button>
          </>
        ) : null}
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
            <DialogTitle>{t("onboarding.exit.deleteTitle")}</DialogTitle>
            <DialogDescription>
              {t("onboarding.exit.deleteDesc")}
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-2 pt-2">
            <label
              htmlFor="onboarding-exit-confirm"
              className="text-[13px] font-medium text-text-2"
            >
              {t("onboarding.exit.deleteConfirmLabel")}
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
              {t("onboarding.exit.deleteCancel")}
            </Button>
            <Button
              variant="destructive"
              onClick={onConfirmDelete}
              disabled={
                deleting ||
                confirmText.trim().toUpperCase() !== "DELETE"
              }
            >
              {deleting ? t("onboarding.exit.deleting") : t("onboarding.exit.deleteConfirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
