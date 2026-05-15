"use client";

import { useEffect } from "react";
import { Loader2 } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { Sidebar, Appbar, Footer } from "@/components/layout";
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

  // Hold off rendering ANY of the dashboard chrome until auth has
  // resolved AND onboardingCompleted is confirmed. The previous
  // version returned children unconditionally while `isLoading`, so
  // a Google-callback round-trip flashed the empty dashboard for a
  // few hundred ms before the redirect to /setup-profile fired. Show
  // a centered spinner during both the loading frame and the
  // about-to-redirect frame so there's no flash of unauthorized
  // content.
  if (isLoading || (user && !user.onboardingCompleted)) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-bg-1">
        <Loader2 className="h-8 w-8 animate-spin text-text-3" />
      </div>
    );
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
                {/* `min-h-full flex-col` + `mt-auto` on Footer makes
                    the copyright row stick to the viewport bottom on
                    short pages and yield naturally on long ones.
                    Bottom padding lives on the Footer now, so we
                    don't double-pad below the copyright line. */}
                <div className="flex min-h-full flex-col px-6 pb-2">
                  {children}
                  <Footer />
                </div>
              </div>
            </main>
          </div>
        </SidebarProvider>
      </OnboardingGuard>
    </AuthProvider>
  );
}