"use client";

import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";

interface SettingsDialogProps {
  open: boolean;
  onClose: () => void;
  onApply?: () => void;
  applyLabel?: string;
  applyVariant?: "default" | "danger";
  title: string;
  description?: string;
  headerIcon?: React.ReactNode;
  headerContent?: React.ReactNode;
  children: React.ReactNode;
}

export function SettingsDialog({
  open,
  onClose,
  onApply,
  applyLabel = "Apply",
  applyVariant = "default",
  title,
  description,
  headerIcon,
  headerContent,
  children,
}: SettingsDialogProps) {
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-md p-0 gap-0 overflow-hidden" showCloseButton={false}>
        <DialogTitle className="sr-only">{title}</DialogTitle>
        <DialogDescription className="sr-only">
          {description ?? `${title} settings`}
        </DialogDescription>

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4">
          <div className="flex items-center gap-3">
            {headerIcon}
            <span className="text-[20px] font-normal leading-[28px] text-text-1">{title}</span>
            {headerContent}
          </div>
          <button onClick={onClose} className="shrink-0 cursor-pointer text-success-7 hover:text-success-7/80">
            <X size={20} strokeWidth={2} />
          </button>
        </div>

        {/* Body */}
        <div className="px-6 pb-5 pt-3">{children}</div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-4">
          <Button
            variant="outline"
            onClick={onClose}
            className="h-[43px] border-border-2 text-text-1 text-[16px] font-normal"
          >
            Cancel
          </Button>
          <Button
            onClick={onApply ?? onClose}
            className={
              applyVariant === "danger"
                ? "h-[43px] bg-danger-6 text-white text-[16px] font-normal hover:bg-danger-6/90"
                : "h-[43px] bg-primary-6 text-white text-[16px] font-normal hover:bg-primary-6/90"
            }
          >
            {applyLabel}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}