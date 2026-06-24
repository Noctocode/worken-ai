"use client";

import {
  Library,
  Wrench,
  Wand2,
  LayoutGrid,
  Sparkles,
  FileText,
  CheckCircle2,
  type LucideIcon,
} from "lucide-react";
import { useLanguage } from "@/lib/i18n";
import { ResourceCard } from "@/components/resource-card";

type TKey = Parameters<ReturnType<typeof useLanguage>["t"]>[0];

interface CardDef {
  titleKey: TKey;
  descKey: TKey;
  bullets: TKey[];
  icon: LucideIcon;
  href: string;
}

const PROMPT_CARDS: CardDef[] = [
  {
    titleKey: "resources.promptLibrary",
    descKey: "toolkit.lib.desc",
    bullets: ["toolkit.lib.b1", "toolkit.lib.b2", "toolkit.lib.b3", "toolkit.lib.b4"],
    icon: Library,
    href: "/toolkit/prompt-library",
  },
  {
    titleKey: "resources.promptBuilder",
    descKey: "toolkit.builder.desc",
    bullets: ["toolkit.builder.b1", "toolkit.builder.b2", "toolkit.builder.b3", "toolkit.builder.b4"],
    icon: Wrench,
    href: "/toolkit/prompt-builder",
  },
  {
    titleKey: "resources.promptImprover",
    descKey: "toolkit.improver.desc",
    bullets: ["toolkit.improver.b1", "toolkit.improver.b2", "toolkit.improver.b3", "toolkit.improver.b4"],
    icon: Wand2,
    href: "/toolkit/prompt-improver",
  },
];

const REUSABLE_CARDS: CardDef[] = [
  {
    titleKey: "resources.shortcuts",
    descKey: "toolkit.shortcuts.desc",
    bullets: ["toolkit.shortcuts.b1", "toolkit.shortcuts.b2", "toolkit.shortcuts.b3", "toolkit.shortcuts.b4"],
    icon: LayoutGrid,
    href: "/toolkit/shortcuts",
  },
  {
    titleKey: "resources.skills",
    descKey: "toolkit.skills.desc",
    bullets: ["toolkit.skills.b1", "toolkit.skills.b2", "toolkit.skills.b3", "toolkit.skills.b4"],
    icon: Sparkles,
    href: "/toolkit/skills",
  },
];

const HERO_FEATURES: Array<{ labelKey: TKey; icon: LucideIcon }> = [
  { labelKey: "resources.enterpriseTemplates", icon: FileText },
  { labelKey: "resources.aiPoweredAnalysis", icon: Sparkles },
  { labelKey: "resources.bestPractices", icon: CheckCircle2 },
];

export default function ToolkitPage() {
  const { t } = useLanguage();

  const card = (c: CardDef) => (
    <ResourceCard
      key={c.href}
      title={t(c.titleKey)}
      description={t(c.descKey)}
      bullets={c.bullets.map((b) => t(b))}
      icon={c.icon}
      href={c.href}
    />
  );

  return (
    <div className="flex flex-col gap-6 py-6">
      {/* Hero banner */}
      <div
        className="flex flex-col gap-4 rounded-lg p-8 text-white"
        style={{ background: "linear-gradient(90deg, #0F52BA 0%, #1E40AF 100%)" }}
      >
        <div className="flex items-center gap-3">
          <Wrench className="h-7 w-7" strokeWidth={2} />
          <h2 className="text-[20px] sm:text-[28px] font-bold leading-[1.5]">
            {t("toolkit.title")}
          </h2>
        </div>
        <p className="max-w-[672px] text-[15px] leading-[1.5]">
          {t("toolkit.subtitle")}
        </p>
        <div className="flex flex-wrap items-center gap-6">
          {HERO_FEATURES.map(({ labelKey, icon: Icon }) => (
            <div key={labelKey} className="flex items-center gap-2">
              <Icon className="h-5 w-5" strokeWidth={2} />
              <span className="text-[13px] leading-[1.5]">{t(labelKey)}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Prompts */}
      <div className="flex flex-col gap-4">
        <h3 className="text-[16px] font-bold leading-[1.5] text-text-1">
          {t("toolkit.promptsHeading")}
        </h3>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {PROMPT_CARDS.map(card)}
        </div>
      </div>

      {/* Shortcuts & Skills */}
      <div className="flex flex-col gap-4">
        <h3 className="text-[16px] font-bold leading-[1.5] text-text-1">
          {t("toolkit.reusableHeading")}
        </h3>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {REUSABLE_CARDS.map(card)}
        </div>
      </div>
    </div>
  );
}
