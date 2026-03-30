"use client";

import { usePathname } from "next/navigation";
import { Sidebar, Appbar } from "@/components/layout";
import { AuthProvider } from "@/components/providers";
import { SidebarProvider } from "@/hooks/use-sidebar";

const WHITE_BG_ROUTES = ["/teams"];

export default function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const isWhiteBg = WHITE_BG_ROUTES.includes(pathname);

  return (
    <AuthProvider>
      <SidebarProvider>
        <div className={`flex h-screen w-full overflow-hidden text-slate-600 selection:bg-blue-100 selection:text-blue-900 ${isWhiteBg ? "bg-bg-white" : "bg-bg-1"}`}>
          <Sidebar />
          <main className="flex min-w-0 flex-1 flex-col">
            <Appbar />
            <div className="min-h-0 flex-1 overflow-auto">
              <div className="flex min-h-full flex-col px-6 py-6">
                {children}
              </div>
            </div>
          </main>
        </div>
      </SidebarProvider>
    </AuthProvider>
  );
}