"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Sidebar, Appbar } from "@/components/layout";
import { AuthProvider, useAuth } from "@/components/providers";
import { SidebarProvider } from "@/hooks/use-sidebar";
import { getRouteConfig } from "@/lib/route-config";

// Any authenticated user who hasn't finished the /setup-profile wizard
// must complete it before entering the app. Atomic completion flips
// users.onboarding_completed_at on step 6's submit.
function OnboardingGuard({ children }: { children: React.ReactNode }) {
  const { user, isLoading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!isLoading && user && !user.onboardingCompleted) {
      router.replace("/setup-profile");
    }
  }, [isLoading, user, router]);

  if (!isLoading && user && !user.onboardingCompleted) {
    return null;
  }
  return <>{children}</>;
}

export default function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const { bg } = getRouteConfig(pathname);

  return (
    <AuthProvider>
      <OnboardingGuard>
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
      </OnboardingGuard>
    </AuthProvider>
  );
}