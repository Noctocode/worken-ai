import type { MetadataRoute } from "next";
import { BRAND } from "@/lib/theme";

// PWA manifest. Next serves this at /manifest.webmanifest and injects the
// <link rel="manifest"> automatically. The SVG covers the scalable "any"
// purpose; the 192/512 PNGs are maskable (white plate + mark inside the
// safe zone) for Android home-screen / install where the OS masks the icon.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "WorkenAI",
    short_name: "WorkenAI",
    description:
      "AI development platform for managing workflows, comparing models, and analyzing documents.",
    start_url: "/",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: BRAND,
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
      {
        src: "/icon-192.png",
        type: "image/png",
        sizes: "192x192",
        purpose: "maskable",
      },
      {
        src: "/icon-512.png",
        type: "image/png",
        sizes: "512x512",
        purpose: "maskable",
      },
    ],
  };
}
