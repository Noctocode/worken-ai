"use client";

import Link from "next/link";
import {
  Network,
  GraduationCap,
  Check,
  ChevronRight,
  BookOpen,
  FileText,
  Sparkles,
  CheckCircle2,
} from "lucide-react";
import { useLanguage } from "@/lib/i18n";

type CardIcon = typeof Network;

interface LearnCard {
  titleKey: string;
  description: string;
  icon: CardIcon;
  bullets: string[];
  href: string;
}

export default function LearningPage() {
  const { t } = useLanguage();

  // Tutorials + learning content. "How WorkenAI works" leads (it used to be
  // its own sidebar item) so the platform overview is the first thing here.
  const LEARN_CARDS: LearnCard[] = [
    {
      titleKey: "resources.howItWorks",
      description:
        "See the platform architecture and the three ways WorkenAI can be deployed.",
      icon: Network,
      bullets: [
        "On-premise deployment",
        "Hybrid deployment",
        "Cloud / managed",
        "Visual architecture diagrams",
      ],
      href: "/learning/how-it-works",
    },
    {
      titleKey: "resources.learnAcademy",
      description:
        "Master prompt engineering with curated lessons and enterprise best practices.",
      icon: GraduationCap,
      bullets: [
        "Structured learning paths",
        "Enterprise case studies",
        "Best practice frameworks",
        "Interactive exercises",
      ],
      href: "/learning/learn-academy",
    },
  ];

  const HERO_FEATURES: Array<{ labelKey: string; icon: typeof FileText }> = [
    { labelKey: "resources.enterpriseTemplates", icon: FileText },
    { labelKey: "resources.aiPoweredAnalysis", icon: Sparkles },
    { labelKey: "resources.bestPractices", icon: CheckCircle2 },
  ];

  return (
    <div className="flex flex-col gap-6 py-6">
      {/* Hero banner */}
      <div
        className="flex flex-col gap-4 rounded-lg p-8 text-white"
        style={{ background: "linear-gradient(90deg, #0F52BA 0%, #1E40AF 100%)" }}
      >
        <div className="flex items-center gap-3">
          <BookOpen className="h-7 w-7" strokeWidth={2} />
          <h2 className="text-[20px] sm:text-[28px] font-bold leading-[1.5]">
            {t("learning.title")}
          </h2>
        </div>
        <p className="max-w-[672px] text-[15px] leading-[1.5]">
          {t("learning.subtitle")}
        </p>
        <div className="flex flex-wrap items-center gap-6">
          {HERO_FEATURES.map(({ labelKey, icon: Icon }) => (
            <div key={labelKey} className="flex items-center gap-2">
              <Icon className="h-5 w-5" strokeWidth={2} />
              <span className="text-[13px] leading-[1.5]">
                {t(labelKey as Parameters<typeof t>[0])}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Learning cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {LEARN_CARDS.map(({ titleKey, icon: Icon, bullets, href, description }) => (
          <Link
            key={titleKey}
            href={href}
            className="flex cursor-pointer flex-col gap-4 rounded-lg border border-border-2 bg-bg-white p-6 transition-colors hover:border-primary-6 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-6"
          >
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-bg-1">
                <Icon className="h-5 w-5 text-primary-7" strokeWidth={2} />
              </div>
              <div className="flex flex-col gap-1">
                <h3 className="text-[18px] font-bold leading-[1.5] text-text-1">
                  {t(titleKey as Parameters<typeof t>[0])}
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
                    className="h-4 w-4 shrink-0 text-success-7"
                    strokeWidth={2.5}
                  />
                  <span className="text-[12px] leading-[1.5] text-text-2">{b}</span>
                </li>
              ))}
            </ul>
            <span className="mt-auto flex items-center gap-2 text-[13px] font-medium text-primary-6 transition-colors">
              {t("resources.openTool")}
              <ChevronRight className="h-4 w-4" />
            </span>
          </Link>
        ))}
      </div>
    </div>
  );
}
