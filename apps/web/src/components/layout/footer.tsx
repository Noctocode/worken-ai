/**
 * Sits in the app shell as the very last child of the scrollable
 * content column. `mt-auto` pushes it to the bottom of the column
 * when the page content is short (so the footer sticks to the
 * viewport bottom on empty pages) and yields naturally when the
 * content overflows. Rendered on every authed route, not just the
 * dashboard.
 */
export const Footer = () => (
  <footer className="mt-auto border-t border-border-2 pt-4 pb-2 text-center text-xs text-text-3">
    <p>&copy; 2026 WorkenAI Inc. All rights reserved.</p>
  </footer>
);
