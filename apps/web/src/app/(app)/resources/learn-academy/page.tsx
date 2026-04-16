"use client";

import Link from "next/link";
import {
  TrendingUp,
  BookOpen,
  Clock,
  CheckCircle2,
  Sparkles,
  FileSearch,
  Database,
  Shield,
  Settings2,
  ListOrdered,
  ArrowLeft,
} from "lucide-react";

type Difficulty = "Beginner" | "Intermediate" | "Advanced";

interface Module {
  title: string;
  description: string;
  difficulty: Difficulty;
  icon: typeof Sparkles;
  progress: number; // 0-100
  duration: string;
  lessons: number;
  lastAt: string;
}

const MODULES: Module[] = [
  {
    title: "Prompt Engineering 101",
    description:
      "Master the fundamentals of crafting effective prompts for enterprise AI applications",
    difficulty: "Beginner",
    icon: Sparkles,
    progress: 65,
    duration: "2h 15m",
    lessons: 8,
    lastAt: "2 days ago",
  },
  {
    title: "Advanced Tender Analysis",
    description:
      "Learn techniques for analyzing complex RFPs and generating competitive bid strategies",
    difficulty: "Advanced",
    icon: FileSearch,
    progress: 30,
    duration: "3h 45m",
    lessons: 12,
    lastAt: "1 week ago",
  },
  {
    title: "Structured Data Extraction",
    description:
      "Extract and structure information from unstructured documents with precision",
    difficulty: "Intermediate",
    icon: Database,
    progress: 100,
    duration: "2h 30m",
    lessons: 10,
    lastAt: "3 days ago",
  },
  {
    title: "AI Safety & Compliance",
    description:
      "Ensure your prompts meet enterprise security and regulatory requirements",
    difficulty: "Intermediate",
    icon: Shield,
    progress: 0,
    duration: "1h 50m",
    lessons: 6,
    lastAt: "Never",
  },
  {
    title: "Prompt Optimization Strategies",
    description:
      "Advanced techniques for improving prompt quality, cost-efficiency, and performance",
    difficulty: "Advanced",
    icon: Settings2,
    progress: 45,
    duration: "3h 20m",
    lessons: 14,
    lastAt: "5 days ago",
  },
];

const DIFFICULTY_STYLES: Record<Difficulty, string> = {
  Beginner: "bg-[#C6EBFF] text-text-2",
  Intermediate: "bg-[#FFE4BA] text-text-3",
  Advanced: "bg-[#FDCDC5] text-text-2",
};

interface Stat {
  icon: typeof TrendingUp;
  label: string;
  value: string;
  caption: string;
}

const STATS: Stat[] = [
  {
    icon: TrendingUp,
    label: "Progress",
    value: "48%",
    caption: "Overall completion",
  },
  {
    icon: BookOpen,
    label: "Modules",
    value: "5",
    caption: "Available courses",
  },
  {
    icon: Clock,
    label: "Time Spent",
    value: "12.5h",
    caption: "This month",
  },
  {
    icon: CheckCircle2,
    label: "Completed",
    value: "1",
    caption: "Modules finished",
  },
];

function StatCard({ stat }: { stat: Stat }) {
  const Icon = stat.icon;
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border-2 bg-bg-white p-5">
      <div className="flex items-center justify-between">
        <Icon className="h-5 w-5 text-text-3" strokeWidth={2} />
        <span className="text-[11px] font-medium uppercase tracking-wide text-text-2">
          {stat.label}
        </span>
      </div>
      <span className="text-2xl font-bold text-text-1">{stat.value}</span>
      <span className="text-xs text-text-2">{stat.caption}</span>
    </div>
  );
}

function ProgressBar({ value }: { value: number }) {
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-border-2">
      <div
        className="h-full rounded-full bg-primary-7 transition-[width]"
        style={{ width: `${Math.min(100, Math.max(0, value))}%` }}
      />
    </div>
  );
}

function ModuleCard({ module: m }: { module: Module }) {
  const Icon = m.icon;
  return (
    <article className="flex cursor-pointer flex-col gap-3 rounded-lg border border-border-2 bg-bg-white p-6 transition-colors hover:border-primary-6">
      <div className="flex items-start justify-between gap-3">
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-[#EBF8FF]">
          <Icon className="h-6 w-6 text-primary-6" strokeWidth={2} />
        </div>
        <span
          className={`inline-flex items-center rounded px-2.5 py-1 text-[11px] font-semibold ${DIFFICULTY_STYLES[m.difficulty]}`}
        >
          {m.difficulty}
        </span>
      </div>

      <h3 className="text-base font-bold leading-snug text-text-1">{m.title}</h3>
      <p className="text-[13px] leading-normal text-text-2">{m.description}</p>

      <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between">
          <span className="text-xs text-text-2">Progress</span>
          <span className="text-xs font-semibold text-text-1">{m.progress}%</span>
        </div>
        <ProgressBar value={m.progress} />
      </div>

      <div className="mt-1 flex items-center justify-between border-t border-border-2 pt-3">
        <div className="flex items-center gap-4 text-xs text-text-2">
          <span className="inline-flex items-center gap-1.5">
            <Clock className="h-3.5 w-3.5" strokeWidth={2} />
            {m.duration}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <ListOrdered className="h-3.5 w-3.5" strokeWidth={2} />
            {m.lessons} lessons
          </span>
        </div>
        <span className="text-[11px] text-text-2">Last: {m.lastAt}</span>
      </div>
    </article>
  );
}

export default function LearnAcademyPage() {
  return (
    <div className="flex flex-col gap-6 py-6">
      <Link
        href="/resources"
        className="inline-flex w-fit cursor-pointer items-center gap-1.5 text-[13px] font-medium text-text-2 hover:text-primary-6"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to Resources
      </Link>

      {/* Intro card */}
      <section className="flex flex-col gap-2 rounded-lg border border-border-2 bg-bg-white p-6">
        <h2 className="text-xl font-bold text-text-1">
          Professional Development
        </h2>
        <p className="text-sm text-text-2">
          Master enterprise prompt engineering through structured learning
          modules and hands-on exercises
        </p>
      </section>

      {/* Stats */}
      <section className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {STATS.map((s) => (
          <StatCard key={s.label} stat={s} />
        ))}
      </section>

      {/* Modules */}
      <section className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {MODULES.map((m) => (
          <ModuleCard key={m.title} module={m} />
        ))}
      </section>
    </div>
  );
}
