"use client";

import { LanguageSelector } from "@/components/language-selector";

/**
 * Fixed top-right language switcher for the pre-auth / pre-app surfaces
 * (login, register, onboarding) where the sidebar — which normally
 * hosts the language selector — isn't mounted yet. Reuses the shared
 * LanguageSelector; the wrapping pill gives it contrast over the
 * full-bleed background image, and side="bottom" opens the menu
 * downward (the sidebar default opens upward).
 */
export function AuthLanguageSwitcher() {
  return (
    <div className="fixed right-4 top-4 z-50 rounded-lg border border-border-2 bg-bg-white/95 px-1 shadow-sm backdrop-blur">
      <LanguageSelector collapsed={false} side="bottom" align="end" />
    </div>
  );
}
