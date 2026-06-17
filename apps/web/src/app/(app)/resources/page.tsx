"use client";

import Link from "next/link";
import {
  BookOpen,
  FileText,
  Sparkles,
  CheckCircle2,
  LayoutGrid,
  Library,
  Wrench,
  Wand2,
  GraduationCap,
  Check,
  ChevronRight,
  Info,
  Network,
} from "lucide-react";
import { useLanguage } from "@/lib/i18n";

type CardIcon = typeof BookOpen;

interface ResourceCard {
  titleKey: string;
  descriptionKey: string;
  icon: CardIcon;
  bullets: string[];
  href?: string;
}

export default function ResourcesPage() {
  const { t } = useLanguage();

  const RESOURCE_CARDS: ResourceCard[] = [
    {
      titleKey: "resources.promptLibrary",
      descriptionKey: "",
      icon: Library,
      bullets: [
        "150+ enterprise templates",
        "Copy & customize instantly",
        "Category-based organization",
        "Usage examples included",
      ],
      href: "/resources/prompt-library",
    },
    {
      titleKey: "resources.promptBuilder",
      descriptionKey: "",
      icon: Wrench,
      bullets: [
        "Pre-built procurement templates",
        "Variable management system",
        "Parameter configuration",
        "Real-time preview & testing",
      ],
      href: "/resources/prompt-builder",
    },
    {
      titleKey: "resources.promptImprover",
      descriptionKey: "",
      icon: Wand2,
      bullets: [
        "AI-powered analysis",
        "Clarity improvements",
        "Specificity optimization",
        "Side-by-side comparison",
      ],
      href: "/resources/prompt-improver",
    },
    {
      titleKey: "resources.learnAcademy",
      descriptionKey: "",
      icon: GraduationCap,
      bullets: [
        "Structured learning paths",
        "Enterprise case studies",
        "Best practice frameworks",
        "Interactive exercises",
      ],
      href: "/resources/learn-academy",
    },
    {
      titleKey: "resources.shortcuts",
      descriptionKey: "",
      icon: LayoutGrid,
      bullets: [
        "Reusable text fragments",
        "Quick popover from the composer",
        "Optional category filter",
        "Up to 500 characters per shortcut",
      ],
      href: "/resources/shortcuts",
    },
    {
      titleKey: "resources.skills",
      descriptionKey: "",
      icon: Sparkles,
      bullets: [
        "Capture how your team does a task",
        "Auto-applied when a message fits",
        "Stays active across a conversation",
        "Import from SKILL.md",
      ],
      href: "/resources/skills",
    },
    {
      titleKey: "resources.howItWorks",
      descriptionKey: "",
      icon: Network,
      bullets: [
        "On-premise deployment",
        "Hybrid deployment",
        "Cloud / managed",
        "Visual architecture diagrams",
      ],
      href: "/resources/how-it-works",
    },
  ];

  const CARD_DESCRIPTIONS: Record<string, string> = {
    "resources.promptLibrary":
      "Access pre-built, production-ready prompts for common procurement workflows.",
    "resources.promptBuilder":
      "Design effective prompts from enterprise templates designed for procurement workflows.",
    "resources.promptImprover":
      "Enhance existing prompts with AI-powered analysis and optimization suggestions.",
    "resources.learnAcademy":
      "Master prompt engineering with curated lessons and enterprise best practices.",
    "resources.shortcuts":
      "Save short text snippets and macros to drop into the composer in one click.",
    "resources.skills":
      "Capture how your team does a task once; the assistant applies it automatically when it fits.",
    "resources.howItWorks":
      "See the platform architecture and the three ways WorkenAI can be deployed.",
  };

  const QUICK_STEPS: Array<{ titleKey: string; description: string }> = [
    {
      titleKey: "resources.startWithBuilder",
      description:
        "Select from enterprise templates designed for procurement tasks like legal summaries, data extraction, and proposal reviews.",
    },
    {
      titleKey: "resources.optimizeWithImprover",
      description:
        "Paste your existing prompts to get AI-powered suggestions for improving clarity, specificity, and effectiveness.",
    },
    {
      titleKey: "resources.learnInAcademy",
      description:
        "Master advanced techniques through structured lessons, real-world case studies, and hands-on exercises.",
    },
  ];

  const BEST_PRACTICES: string[] = [
    "Always specify output format and structure requirements",
    "Use variables for reusable prompts across different documents",
    "Test prompts with multiple examples before production use",
    "Document prompt versions and track performance metrics",
    "Follow compliance guidelines for sensitive data handling",
  ];

  const HERO_FEATURES: Array<{ labelKey: string; icon: typeof FileText }> = [
    { labelKey: "resources.enterpriseTemplates", icon: FileText },
    { labelKey: "resources.aiPoweredAnalysis", icon: Sparkles },
    { labelKey: "resources.bestPractices", icon: CheckCircle2 },
  ];

  return (
    <div className="flex flex-col gap-6 py-6">
      {/* Hero banner — Figma frame 4158-24833 */}
      <div
        className="flex flex-col gap-4 rounded-lg p-8 text-white"
        style={{
          background: "linear-gradient(90deg, #0F52BA 0%, #1E40AF 100%)",
        }}
      >
        <div className="flex items-center gap-3">
          <BookOpen className="h-7 w-7" strokeWidth={2} />
          <h2 className="text-[20px] sm:text-[28px] font-bold leading-[1.5]">
            {t("resources.title")}
          </h2>
        </div>

        <p className="max-w-[672px] text-[15px] leading-[1.5]">
          {t("resources.subtitle")}
        </p>

        <div className="flex flex-wrap items-center gap-6">
          {HERO_FEATURES.map(({ labelKey, icon: Icon }) => (
            <div key={labelKey} className="flex items-center gap-2">
              <Icon className="h-5 w-5" strokeWidth={2} />
              <span className="text-[13px] leading-[1.5]">{t(labelKey as Parameters<typeof t>[0])}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Resource tools grid */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {RESOURCE_CARDS.map(({ titleKey, icon: Icon, bullets, href }) => {
          const title = t(titleKey as Parameters<typeof t>[0]);
          const description = CARD_DESCRIPTIONS[titleKey] ?? "";
          const body = (
            <>
              <div className="flex items-start gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-bg-1">
                  <Icon className="h-5 w-5 text-primary-7" strokeWidth={2} />
                </div>
                <div className="flex flex-col gap-1">
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
                      className="h-4 w-4 shrink-0 text-success-7"
                      strokeWidth={2.5}
                    />
                    <span className="text-[12px] leading-[1.5] text-text-2">
                      {b}
                    </span>
                  </li>
                ))}
              </ul>

              <span
                className={`mt-auto flex items-center gap-2 text-[13px] font-medium transition-colors ${
                  href ? "text-primary-6" : "text-text-3"
                }`}
              >
                {t("resources.openTool")}
                <ChevronRight className="h-4 w-4" />
              </span>
            </>
          );

          return href ? (
            <Link
              key={titleKey}
              href={href}
              className="flex cursor-pointer flex-col gap-4 rounded-lg border border-border-2 bg-bg-white p-6 transition-colors hover:border-primary-6 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-6"
            >
              {body}
            </Link>
          ) : (
            <div
              key={titleKey}
              className="flex flex-col gap-4 rounded-lg border border-border-2 bg-bg-white p-6"
            >
              {body}
            </div>
          );
        })}
      </div>

      {/* Quick Start Guide */}
      <div className="flex flex-col gap-6 rounded-lg border border-border-2 bg-bg-white p-6">
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-bg-1">
            <Sparkles className="h-4 w-4 text-primary-7" strokeWidth={2} />
          </div>
          <h3 className="text-[20px] font-bold leading-[1.5] text-text-1">
            {t("resources.quickStartGuide")}
          </h3>
        </div>

        <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
          {QUICK_STEPS.map((s, i) => (
            <div key={s.titleKey} className="flex flex-col gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-bg-1">
                <span className="text-[16px] font-bold leading-[1.5] text-text-1">
                  {i + 1}
                </span>
              </div>
              <h4 className="text-[15px] font-semibold leading-[1.5] text-text-1">
                {t(s.titleKey as Parameters<typeof t>[0])}
              </h4>
              <p className="text-[13px] leading-[1.625] text-text-2">
                {s.description}
              </p>
            </div>
          ))}
        </div>
      </div>

      {/* Best practices callout */}
      <div className="flex items-start gap-3 rounded-lg border border-text-3 bg-bg-1 p-6">
        <Info className="h-5 w-5 shrink-0 text-text-2" strokeWidth={2} />
        <div className="flex flex-col gap-2">
          <h4 className="text-[14px] font-semibold leading-[1.5] text-text-2">
            {t("resources.enterpriseBestPractices")}
          </h4>
          <ul className="flex flex-col gap-1.5 text-[12px] leading-[1.5] text-text-1">
            {BEST_PRACTICES.map((p) => (
              <li key={p}>• {p}</li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
