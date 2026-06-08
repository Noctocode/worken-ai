"use client";

import { useAuth } from "@/components/providers";

/**
 * Single source of truth for "is this a personal profile" — the gate
 * for hiding/disabling team & company features.
 *
 * While auth is still resolving (`isLoading`) we don't yet know the
 * profile, so we treat it as NON-personal: a company user must never
 * flash the restricted personal layout on first paint (the
 * AuthProvider renders children with `user = null` until /auth/me
 * resolves). Once resolved, a profile counts as personal unless it's
 * explicitly `company`.
 */
export function isPersonalProfile(
  user: { profileType?: string | null } | null | undefined,
  isLoading = false,
): boolean {
  if (isLoading) return false;
  return user?.profileType !== "company";
}

/** Hook form for components that read the current user via context. */
export function useIsPersonal(): boolean {
  const { user, isLoading } = useAuth();
  return isPersonalProfile(user, isLoading);
}
