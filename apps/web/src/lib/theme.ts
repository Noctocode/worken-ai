export const theme = {
  container: { maxWidth: "1280px" },
  layout: { sidebarWidth: "18rem", appbarHeight: "4.5rem" },
} as const;

/**
 * WorkenAI brand blue for the favicon mark and the browser/OS theme colour.
 * Imported by app/apple-icon.tsx, app/manifest.ts and the root layout's
 * `viewport.themeColor` — those need a concrete hex at build time, so they
 * can't read the `--primary-6` CSS token. Keep this in sync with
 * `--primary-6` in app/globals.css (same value).
 *
 * Two assets carry the value literally and can't import this: app/icon.svg
 * (a static SVG `fill`) and the generated public/icon-{192,512}.png. If the
 * colour changes, update icon.svg and regenerate those PNGs to match.
 */
export const BRAND = "#178ACA";
