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
import { useLanguage } from "@/lib/i18n";

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
  onConnectConfirm?: (products: Product[]) => void;
  onDisconnectConfirm?: (both: boolean) => void;
  loading?: boolean;
}

export function MicrosoftConnectConfirmDialog({
  open,
  onOpenChange,
  mode,
  onConnectConfirm,
  onDisconnectConfirm,
  loading,
}: Props) {
  const { t } = useLanguage();

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
  const fill = (key: Parameters<typeof t>[0]) =>
    t(key).replace("{primary}", primaryLabel).replace("{other}", otherLabel);

  if (mode.kind === "connectInitial") {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-[480px]">
          <DialogHeader>
            <DialogTitle>{fill("msConnect.connectTitle")}</DialogTitle>
            <DialogDescription>
              {fill("msConnect.connectInitialDesc")}
            </DialogDescription>
          </DialogHeader>

          <DialogFooter className="gap-2 sm:justify-end">
            <Button
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={loading}
              className="cursor-pointer"
            >
              {t("msConnect.cancel")}
            </Button>
            <Button
              variant="outline"
              onClick={() => onConnectConfirm?.([primary])}
              disabled={loading}
              className="cursor-pointer gap-2"
            >
              {loading && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              {fill("msConnect.justPrimary")}
            </Button>
            <Button
              onClick={() => onConnectConfirm?.([primary, other])}
              disabled={loading}
              className="cursor-pointer gap-2"
            >
              {loading && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              {t("msConnect.bothProducts")}
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
            <DialogTitle>{fill("msConnect.enableTitle")}</DialogTitle>
            <DialogDescription>
              {fill("msConnect.connectAddonDesc")}
            </DialogDescription>
          </DialogHeader>

          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={loading}
              className="cursor-pointer"
            >
              {t("msConnect.cancel")}
            </Button>
            <Button
              onClick={() => onConnectConfirm?.([primary])}
              disabled={loading}
              className="cursor-pointer gap-2"
            >
              {loading && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              {fill("msConnect.enable")}
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
          <DialogTitle>{fill("msConnect.disconnectTitle")}</DialogTitle>
          <DialogDescription>
            {fill("msConnect.disconnectDesc")}
          </DialogDescription>
        </DialogHeader>

        <DialogFooter className="gap-2 sm:justify-end">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={loading}
            className="cursor-pointer"
          >
            {t("msConnect.cancel")}
          </Button>
          <Button
            variant="outline"
            onClick={() => onDisconnectConfirm?.(false)}
            disabled={loading}
            className="cursor-pointer gap-2"
          >
            {loading && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {fill("msConnect.justPrimary")}
          </Button>
          <Button
            onClick={() => onDisconnectConfirm?.(true)}
            disabled={loading}
            className="cursor-pointer gap-2 bg-danger-6 hover:bg-danger-7 text-primary-foreground"
          >
            {loading && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {t("msConnect.bothProducts")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
