"use client";

import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

import { Sidebar, Appbar, Footer } from "@/components/layout";

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
            <div className="flex-1 overflow-y-auto">
              <div className="p-4 sm:p-8">
                <div className="mx-auto max-w-7xl">
                  {children}
                </div>
                <Footer />
              </div>
            </div>
          </main>
        </div>
      </body>
    </html>
  );
}
