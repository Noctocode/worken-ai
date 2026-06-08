"use client";

import Link from "next/link";
import { useLanguage } from "@/lib/i18n";

/**
 * Empty-state shown on company-tenant surfaces (Teams, Users, Company)
 * when the workspace is a personal profile. The capability isn't
 * deleted — it just doesn't apply to a sole personal account — so we
 * explain that and point at My Account, where the user can switch
 * their profile type. Mirrors the wording of `mgmt.company.personalOnly`.
 */
export function PersonalProfileNotice({ message }: { message: string }) {
  const { t } = useLanguage();
  return (
    <div className="flex flex-col items-center gap-2 py-12 text-center">
      <p className="max-w-[460px] text-[14px] text-text-3">{message}</p>
      <Link
        href="/teams?tab=my-account"
        className="text-[13px] font-medium text-primary-6 hover:text-primary-7"
      >
        {t("common.visitMyAccount")}
      </Link>
    </div>
  );
}
