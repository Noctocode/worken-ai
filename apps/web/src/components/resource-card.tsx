"use client";

import Link from "next/link";
import { Check, ChevronRight, Clock, type LucideIcon } from "lucide-react";
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
 * landings stay visually in sync. `comingSoon` renders a non-interactive
 * variant with a "Coming soon" pill in the top-right corner.
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
        <span className="absolute right-4 top-4 inline-flex items-center gap-1 rounded-full bg-warning-1 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-warning-6">
          <Clock className="h-3 w-3" strokeWidth={2.5} />
          {t("resources.comingSoon")}
        </span>
      )}
      <div className="flex items-start gap-3">
        <div
          className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${
            comingSoon ? "bg-bg-2" : "bg-bg-1"
          }`}
        >
          <Icon
            className={`h-5 w-5 ${comingSoon ? "text-text-3" : "text-primary-7"}`}
            strokeWidth={2}
          />
        </div>
        <div className="flex flex-col gap-1 pr-24">
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
            <Check
              className={`h-4 w-4 shrink-0 ${comingSoon ? "text-text-3" : "text-success-7"}`}
              strokeWidth={2.5}
            />
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
        className="relative flex cursor-default flex-col gap-4 rounded-lg border border-border-2 bg-bg-1 p-6"
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
