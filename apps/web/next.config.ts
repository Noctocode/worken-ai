import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  devIndicators: false,
  output: "standalone",
  outputFileTracingRoot: "../..",
  turbopack: {
    root: "../..",
  },
  // The old /resources hub was split into /learning (tutorials) and
  // /toolkit (prompts, shortcuts, skills). Keep old bookmarks / links alive.
  async redirects() {
    return [
      { source: "/resources/how-it-works", destination: "/learning/how-it-works", permanent: true },
      { source: "/resources/learn-academy/:slug*", destination: "/learning/learn-academy/:slug*", permanent: true },
      { source: "/resources/prompt-library", destination: "/toolkit/prompt-library", permanent: true },
      { source: "/resources/prompt-builder", destination: "/toolkit/prompt-builder", permanent: true },
      { source: "/resources/prompt-improver", destination: "/toolkit/prompt-improver", permanent: true },
      { source: "/resources/shortcuts", destination: "/toolkit/shortcuts", permanent: true },
      { source: "/resources/skills", destination: "/toolkit/skills", permanent: true },
      // The hub kept the name "Resources & Learning" → that section is /learning.
      { source: "/resources", destination: "/learning", permanent: true },
      // Learn Academy isn't live yet (shown as "Coming soon"). Gate the route
      // so a direct URL / old bookmark can't reach the unfinished page. TEMPORARY
      // (307) — drop this line to switch the Academy on; the page already exists.
      { source: "/learning/learn-academy/:slug*", destination: "/learning", permanent: false },
    ];
  },
};

export default nextConfig;
