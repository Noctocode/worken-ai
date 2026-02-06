"use client";

import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

import { Sidebar, Appbar } from "@/components/layout";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <div className="flex h-screen w-full overflow-hidden bg-slate-50/50 text-slate-600 selection:bg-blue-100 selection:text-blue-900">
          <Sidebar />
          <main className="flex min-w-0 flex-1 flex-col">
            <Appbar />
            <div className="flex min-h-0 flex-1 flex-col">
              {children}
            </div>
          </main>
        </div>
      </body>
    </html>
  );
}
