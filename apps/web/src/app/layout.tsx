import type { Metadata, Viewport } from "next";
import { IBM_Plex_Sans, IBM_Plex_Mono } from "next/font/google";
import "./globals.css";

import { Providers } from "@/components/providers";
import { BRAND } from "@/lib/theme";

const ibmPlexSans = IBM_Plex_Sans({
  variable: "--font-geist-sans",
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700"],
});

const ibmPlexMono = IBM_Plex_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
});

// Browser tab: name + description. Sub-pages may set their own title and
// it is appended as "<page> · WorkenAI". The favicon comes from the
// app/icon.svg file convention (the WorkenAI mark, vector — sharp at any
// size); app/favicon.ico is a branded raster fallback (16/32/48) for legacy
// clients and bots that request /favicon.ico directly. iOS uses
// app/apple-icon.tsx and PWAs read app/manifest.ts.
export const metadata: Metadata = {
  title: {
    default: "WorkenAI",
    template: "%s · WorkenAI",
  },
  description:
    "AI development platform for managing workflows, comparing models, and analyzing documents.",
};

// Brand colour for the browser/OS UI (mobile address bar, PWA splash).
export const viewport: Viewport = {
  themeColor: BRAND,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${ibmPlexSans.variable} ${ibmPlexMono.variable} antialiased`}
      >
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
