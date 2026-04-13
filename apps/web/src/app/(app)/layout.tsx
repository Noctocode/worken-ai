"use client";

import { usePathname } from "next/navigation";
import { Sidebar, Appbar } from "@/components/layout";
import { AuthProvider } from "@/components/providers";
import { SidebarProvider } from "@/hooks/use-sidebar";
import { getRouteConfig } from "@/lib/route-config";

export default function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const { bg } = getRouteConfig(pathname);

  return (
    <AuthProvider>
      <SidebarProvider>
        <div className={`flex h-screen w-full overflow-hidden text-slate-600 selection:bg-blue-100 selection:text-blue-900 ${bg}`}>
          <Sidebar />
          <main className="flex min-w-0 flex-1 flex-col">
            <Appbar />
            <div className="min-h-0 flex-1 overflow-auto">
              <div className="flex min-h-full flex-col px-6 pb-6">
                {children}
              </div>
            </div>
          </main>
        </div>
      </SidebarProvider>
    </AuthProvider>
  );
}