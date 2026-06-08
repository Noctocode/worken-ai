"use client";

import { useAuth } from "@/components/providers";

/**
 * Single source of truth for "is this a personal profile" — the gate
 * for hiding/disabling team & company features. A profile counts as
 * personal unless it's explicitly `company` (so a null/loading
 * profileType defaults to the more restrictive personal view).
 */
export function isPersonalProfile(
  user: { profileType?: string | null } | null | undefined,
): boolean {
  return user?.profileType !== "company";
}

/** Hook form for components that read the current user via context. */
export function useIsPersonal(): boolean {
  return isPersonalProfile(useAuth().user);
}
