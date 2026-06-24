import type { MetadataRoute } from "next";

// PWA manifest. Next serves this at /manifest.webmanifest and injects the
// <link rel="manifest"> automatically. Icons reuse the app/icon.svg (scalable,
// any size) and the iOS PNG from app/apple-icon.tsx.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "WorkenAI",
    short_name: "WorkenAI",
    description:
      "AI development platform for managing workflows, comparing models, and analyzing documents.",
    start_url: "/",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#178ACA",
    icons: [
      {
        src: "/icon.svg",
        type: "image/svg+xml",
        sizes: "any",
      },
      {
        src: "/apple-icon",
        type: "image/png",
        sizes: "180x180",
      },
    ],
  };
}
