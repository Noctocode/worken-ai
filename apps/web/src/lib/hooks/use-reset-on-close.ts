"use client";

import { useEffect } from "react";

/**
 * Run `reset` whenever a dialog transitions to closed, so reopening always
 * starts fresh instead of showing the previous (cancelled) draft. This
 * covers every close path — Cancel / Esc / overlay / the X, and the
 * programmatic `setOpen(false)` a mutation fires on success — because they
 * all flip `open` to false.
 *
 * Pass any "is open" boolean: a real `open` state, or a derived expression
 * like `moveFileId !== null` / `stagedFiles.length > 0`.
 *
 * The effect is keyed only on `open`. `reset` is intentionally left out of
 * the deps: callers pass an inline closure (new identity every render) that
 * only ever calls stable state setters, so re-running on its identity would
 * be pointless churn. Centralising the one lint-disable here keeps it out of
 * every individual dialog.
 */
export function useResetOnClose(open: boolean, reset: () => void) {
  useEffect(() => {
    if (!open) reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
}
