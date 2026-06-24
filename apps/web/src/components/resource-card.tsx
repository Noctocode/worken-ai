"use client";

import Link from "next/link";
import { Check, ChevronRight, type LucideIcon } from "lucide-react";
import { useLanguage } from "@/lib/i18n";

export interface ResourceCardProps {
  /** Already-translated title + description + bullets (callers pass t(...)). */
  title: string;
  description: string;
  icon: LucideIcon;
  bullets: string[];
  href: string;
  /** Render as a non-clickable "Coming soon" card. */
  comingSoon?: boolean;
}

/**
 * Card used on the Toolkit and Learning landing pages — icon + title +
 * description + a bullet list + an "Open" affordance. Shared so the two
 * landings stay visually in sync. `comingSoon` keeps the normal (white)
 * card but dims the whole thing and adds a diagonal blue corner ribbon.
 */
export function ResourceCard({
  title,
  description,
  icon: Icon,
  bullets,
  href,
  comingSoon = false,
}: ResourceCardProps) {
  const { t } = useLanguage();

  const body = (
    <>
      {comingSoon && (
        <span className="pointer-events-none absolute right-[-52px] top-[22px] w-[180px] rotate-45 bg-primary-6 py-1 text-center text-[10px] font-semibold uppercase tracking-wider text-white shadow-sm">
          {t("resources.comingSoon")}
        </span>
      )}
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-bg-1">
          <Icon className="h-5 w-5 text-primary-7" strokeWidth={2} />
        </div>
        <div className={`flex flex-col gap-1 ${comingSoon ? "pr-16" : ""}`}>
          <h3 className="text-[18px] font-bold leading-[1.5] text-text-1">
            {title}
          </h3>
          <p className="text-[13px] leading-[1.625] text-text-2">
            {description}
          </p>
        </div>
      </div>
      <ul className="flex flex-col gap-2">
        {bullets.map((b) => (
          <li key={b} className="flex items-center gap-2">
            <Check className="h-4 w-4 shrink-0 text-success-7" strokeWidth={2.5} />
            <span className="text-[12px] leading-[1.5] text-text-2">{b}</span>
          </li>
        ))}
      </ul>
      {!comingSoon && (
        <span className="mt-auto flex items-center gap-2 text-[13px] font-medium text-primary-6 transition-colors">
          {t("resources.openTool")}
          <ChevronRight className="h-4 w-4" />
        </span>
      )}
    </>
  );

  if (comingSoon) {
    return (
      <div
        aria-disabled="true"
        className="relative flex cursor-default flex-col gap-4 overflow-hidden rounded-lg border border-border-2 bg-bg-white p-6 opacity-60"
      >
        {body}
      </div>
    );
  }

  return (
    <Link
      href={href}
      className="relative flex cursor-pointer flex-col gap-4 rounded-lg border border-border-2 bg-bg-white p-6 transition-colors hover:border-primary-6 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-6"
    >
      {body}
    </Link>
  );
}
