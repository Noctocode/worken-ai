"use client";

import { Sidebar, Appbar } from "@/components/layout";
import { AuthProvider } from "@/components/providers";

export default function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <AuthProvider>
      <div className="flex h-screen w-full overflow-hidden bg-slate-50/50 text-slate-600 selection:bg-blue-100 selection:text-blue-900">
        <Sidebar />
        <main className="flex min-w-0 flex-1 flex-col">
          <Appbar />
          <div className="flex min-h-0 flex-1 flex-col">{children}</div>
        </main>
      </div>
    </AuthProvider>
  );
}
