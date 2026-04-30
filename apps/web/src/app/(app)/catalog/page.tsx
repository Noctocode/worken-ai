"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { useAuth } from "@/components/providers";
import { CatalogTab } from "@/components/management/catalog-tab";

export default function CatalogPage() {
  const router = useRouter();
  const { user, isLoading } = useAuth();

  // Admin gate: bounce non-admins to the dashboard. The BE also enforces
  // this on every catalog endpoint, but we redirect early so non-admins
  // don't see the loading skeleton + permission error toast.
  useEffect(() => {
    if (!isLoading && user && user.role !== "admin") {
      router.replace("/");
    }
  }, [isLoading, user, router]);

  if (isLoading || !user) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-6 w-6 animate-spin text-text-3" />
      </div>
    );
  }
  if (user.role !== "admin") {
    // Effect above will redirect; render nothing in the meantime to avoid
    // a flash of restricted content.
    return null;
  }

  return (
    <div className="pt-4">
      <CatalogTab />
    </div>
  );
}
