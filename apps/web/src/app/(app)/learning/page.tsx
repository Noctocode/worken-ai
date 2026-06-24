"use client";

import {
  Network,
  GraduationCap,
  MonitorPlay,
  BookOpen,
  Compass,
  Lightbulb,
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
  comingSoon?: boolean;
}

// Tutorials + learning content. "How WorkenAI works" leads (it used to be
// its own sidebar item) so the platform overview is the first thing here.
const LEARN_CARDS: CardDef[] = [
  {
    titleKey: "resources.howItWorks",
    descKey: "learning.how.desc",
    bullets: ["learning.how.b1", "learning.how.b2", "learning.how.b3", "learning.how.b4"],
    icon: Network,
    href: "/learning/how-it-works",
  },
  {
    titleKey: "resources.learnAcademy",
    descKey: "learning.academy.desc",
    bullets: [
      "learning.academy.b1",
      "learning.academy.b2",
      "learning.academy.b3",
      "learning.academy.b4",
    ],
    icon: GraduationCap,
    href: "/learning/learn-academy",
    comingSoon: true,
  },
  {
    titleKey: "learning.video.title",
    descKey: "learning.video.desc",
    bullets: [
      "learning.video.b1",
      "learning.video.b2",
      "learning.video.b3",
      "learning.video.b4",
    ],
    icon: MonitorPlay,
    href: "/learning/video-tutorials",
    comingSoon: true,
  },
];

const HERO_FEATURES: Array<{ labelKey: TKey; icon: LucideIcon }> = [
  { labelKey: "learning.heroOverview", icon: Compass },
  { labelKey: "learning.heroLessons", icon: Lightbulb },
  { labelKey: "learning.heroBest", icon: CheckCircle2 },
];

export default function LearningPage() {
  const { t } = useLanguage();

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
              <span className="text-[13px] leading-[1.5]">{t(labelKey)}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Learning cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {LEARN_CARDS.map((c) => (
          <ResourceCard
            key={c.href}
            title={t(c.titleKey)}
            description={t(c.descKey)}
            bullets={c.bullets.map((b) => t(b))}
            icon={c.icon}
            href={c.href}
            comingSoon={c.comingSoon}
          />
        ))}
      </div>
    </div>
  );
}
