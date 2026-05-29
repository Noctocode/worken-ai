"use client";

import { Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

type Product = "sharepoint" | "onedrive";

const LABEL: Record<Product, string> = {
  sharepoint: "SharePoint",
  onedrive: "OneDrive",
};

export type MicrosoftConfirmMode =
  | { kind: "connectInitial"; primary: Product }
  | { kind: "connectAddon"; primary: Product }
  | { kind: "disconnect"; primary: Product };

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: MicrosoftConfirmMode | null;
  /**
   * Resolves a "Connect"-mode answer with the product list to enable.
   * Empty array => user cancelled (also fired via onOpenChange(false)).
   */
  onConnectConfirm?: (products: Product[]) => void;
  /**
   * Resolves a "Disconnect"-mode answer. `both === true` => delete the
   * underlying Microsoft connection; `false` => only flip the primary
   * product's enable flag off.
   */
  onDisconnectConfirm?: (both: boolean) => void;
  /** Show a spinner while the parent's mutation is in flight. */
  loading?: boolean;
}

/**
 * Shared confirm dialog used by both `SharePointSection` and
 * `OneDriveSection` to drive the per-product connect/disconnect UX.
 *
 * The three modes:
 *   - `connectInitial`  — no Microsoft connection yet. Offers
 *                         "Both products" (default) / "Just {primary}"
 *                         / "Cancel".
 *   - `connectAddon`    — Microsoft already connected via the other
 *                         product. No OAuth needed — just flip the
 *                         enable flag. Offers "Enable {primary}" /
 *                         "Cancel".
 *   - `disconnect`      — Offers "Just {primary}" / "Both products" /
 *                         "Cancel".
 *
 * Caller is responsible for the actual API call; this component just
 * collects the user's intent.
 */
export function MicrosoftConnectConfirmDialog({
  open,
  onOpenChange,
  mode,
  onConnectConfirm,
  onDisconnectConfirm,
  loading,
}: Props) {
  if (!mode) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-[440px]" />
      </Dialog>
    );
  }

  const primary = mode.primary;
  const other: Product = primary === "sharepoint" ? "onedrive" : "sharepoint";
  const primaryLabel = LABEL[primary];
  const otherLabel = LABEL[other];

  if (mode.kind === "connectInitial") {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-[480px]">
          <DialogHeader>
            <DialogTitle>Connect {primaryLabel}</DialogTitle>
            <DialogDescription>
              Signing in with Microsoft also covers {otherLabel} —
              they use the same account. You can enable just
              {" "}{primaryLabel}, or both at once. Either way you only
              sign in once.
            </DialogDescription>
          </DialogHeader>

          <DialogFooter className="gap-2 sm:justify-end">
            <Button
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={loading}
              className="cursor-pointer"
            >
              Cancel
            </Button>
            <Button
              variant="outline"
              onClick={() => onConnectConfirm?.([primary])}
              disabled={loading}
              className="cursor-pointer gap-2"
            >
              {loading && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              Just {primaryLabel}
            </Button>
            <Button
              onClick={() => onConnectConfirm?.([primary, other])}
              disabled={loading}
              className="cursor-pointer gap-2"
            >
              {loading && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              Both products
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }

  if (mode.kind === "connectAddon") {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-[440px]">
          <DialogHeader>
            <DialogTitle>Enable {primaryLabel}</DialogTitle>
            <DialogDescription>
              You&rsquo;re already signed in with Microsoft for
              {" "}{otherLabel}. {primaryLabel} uses the same account —
              no re-sign-in needed. Enable it now?
            </DialogDescription>
          </DialogHeader>

          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={loading}
              className="cursor-pointer"
            >
              Cancel
            </Button>
            <Button
              onClick={() => onConnectConfirm?.([primary])}
              disabled={loading}
              className="cursor-pointer gap-2"
            >
              {loading && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              Enable {primaryLabel}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }

  // disconnect
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[480px]">
        <DialogHeader>
          <DialogTitle>Disconnect from {primaryLabel}?</DialogTitle>
          <DialogDescription>
            Stop using {primaryLabel} on this Microsoft connection.
            {otherLabel === otherLabel /* always true */ && (
              <>
                {" "}If {otherLabel} is also enabled, you can keep it
                connected or disconnect from both at once.
              </>
            )}
          </DialogDescription>
        </DialogHeader>

        <DialogFooter className="gap-2 sm:justify-end">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={loading}
            className="cursor-pointer"
          >
            Cancel
          </Button>
          <Button
            variant="outline"
            onClick={() => onDisconnectConfirm?.(false)}
            disabled={loading}
            className="cursor-pointer gap-2"
          >
            {loading && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            Just {primaryLabel}
          </Button>
          <Button
            onClick={() => onDisconnectConfirm?.(true)}
            disabled={loading}
            className="cursor-pointer gap-2 bg-danger-6 hover:bg-danger-7 text-primary-foreground"
          >
            {loading && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            Both products
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
