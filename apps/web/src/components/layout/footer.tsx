"use client";

import { useLanguage } from "@/lib/i18n";

/**
 * Sits in the app shell as the very last child of the scrollable
 * content column. `mt-auto` pushes it to the bottom of the column
 * when the page content is short (so the footer sticks to the
 * viewport bottom on empty pages) and yields naturally when the
 * content overflows. Rendered on every authed route, not just the
 * dashboard.
 *
 * Hidden at <md: mobile pages already pack a sticky bottom bar on
 * several routes (e.g. /projects/create) and the copyright line eats
 * a row of vertical space that's worth more than the brand reminder
 * on a 375px viewport.
 */
export const Footer = () => {
  const { t } = useLanguage();
  return (
    <footer className="hidden md:block mt-auto border-t border-border-2 pt-4 pb-2 text-center text-xs text-text-3">
      <p>{t("footer.rights")}</p>
    </footer>
  );
};
