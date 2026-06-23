import type { Metadata } from "next";
import { IBM_Plex_Sans, IBM_Plex_Mono } from "next/font/google";
import "./globals.css";

import { Providers } from "@/components/providers";

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
// app/icon.png file convention (the WorkenAI mark).
export const metadata: Metadata = {
  title: {
    default: "WorkenAI",
    template: "%s · WorkenAI",
  },
  description:
    "AI development platform for managing workflows, comparing models, and analyzing documents.",
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
