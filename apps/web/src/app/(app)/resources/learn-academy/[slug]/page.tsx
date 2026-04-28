"use client";

import { use, useState } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ArrowLeft,
  Clock,
  Play,
  FileText,
  Code,
  ExternalLink,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  getModuleBySlug,
  type Lesson,
  type LessonResource,
} from "@/lib/learn-academy-data";

const RESOURCE_ICONS: Record<LessonResource["kind"], LucideIcon> = {
  pdf: FileText,
  code: Code,
  link: ExternalLink,
};

function VideoPlayer({ lesson, lessonIndex, totalLessons }: {
  lesson: Lesson;
  lessonIndex: number;
  totalLessons: number;
}) {
  return (
    <section className="overflow-hidden rounded-lg border border-border-2 bg-bg-white">
      <div className="relative flex aspect-video w-full items-center justify-center bg-black">
        <button
          type="button"
          className="flex h-16 w-16 cursor-pointer items-center justify-center rounded-full bg-primary-7 text-white transition-transform hover:scale-105"
          aria-label="Play lesson"
        >
          <Play className="h-8 w-8 fill-current" strokeWidth={0} />
        </button>
        <div className="absolute inset-x-0 bottom-0 h-4 bg-bg-white/10" />
      </div>
      <div className="flex flex-col gap-2 p-6">
        <h2 className="text-[18px] font-bold leading-[1.5] text-text-1">
          Lesson {lessonIndex}: {lesson.title}
        </h2>
        <p className="text-[13px] leading-[1.5] text-text-2">
          {lesson.description}
        </p>
        <div className="mt-1 flex items-center gap-3 text-[12px] text-text-2">
          <span className="inline-flex items-center gap-1.5">
            <Clock className="h-3.5 w-3.5" strokeWidth={2} />
            {lesson.duration}
          </span>
          <span>•</span>
          <span>
            Lesson {lessonIndex} of {totalLessons}
          </span>
        </div>
      </div>
    </section>
  );
}

function ChapterMarkers({
  lesson,
  activeTime,
  onSelect,
}: {
  lesson: Lesson;
  activeTime: string;
  onSelect: (time: string) => void;
}) {
  return (
    <section className="flex flex-col gap-3 rounded-lg border border-border-2 bg-bg-white p-5">
      <h3 className="text-[14px] font-semibold text-text-1">Chapter Markers</h3>
      <ul className="flex flex-col gap-2">
        {lesson.chapters.map((c) => {
          const active = c.time === activeTime;
          return (
            <li key={c.time}>
              <button
                type="button"
                onClick={() => onSelect(c.time)}
                className={`flex w-full cursor-pointer items-start gap-3 rounded px-3 py-2.5 text-left transition-colors ${
                  active
                    ? "bg-primary-1"
                    : "hover:bg-bg-1"
                }`}
              >
                <span className="shrink-0 font-mono text-[11px] leading-[1.5] text-text-2">
                  {c.time}
                </span>
                <div className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-[12px] font-medium text-text-1">
                    {c.title}
                  </span>
                  <span className="text-[11px] font-medium text-text-2">
                    {c.duration}
                  </span>
                </div>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function Transcript({ lesson }: { lesson: Lesson }) {
  return (
    <section className="flex flex-col gap-3 rounded-lg border border-border-2 bg-bg-white p-5">
      <h3 className="text-[14px] font-semibold text-text-1">Transcript</h3>
      <div className="flex flex-col gap-3">
        {lesson.transcript.map((p) => (
          <p
            key={p.time}
            className="font-mono text-[12px] leading-[1.625] text-text-1"
          >
            [{p.time}] {p.text}
          </p>
        ))}
      </div>
    </section>
  );
}

function Resources({ lesson }: { lesson: Lesson }) {
  return (
    <section className="flex flex-col gap-3 rounded-lg border border-border-2 bg-bg-white p-5">
      <h3 className="text-[14px] font-semibold text-text-1">Resources</h3>
      <ul className="flex flex-col gap-2">
        {lesson.resources.map((r) => {
          const Icon = RESOURCE_ICONS[r.kind];
          return (
            <li key={r.label}>
              <button
                type="button"
                className="flex w-full cursor-pointer items-center gap-3 rounded px-3 py-2 text-left transition-colors hover:bg-bg-1"
              >
                <Icon className="h-4 w-4 text-text-2" strokeWidth={2} />
                <span className="text-[12px] font-medium text-text-2">
                  {r.label}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

export default function LessonDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = use(params);
  const module = getModuleBySlug(slug);

  const [activeTime, setActiveTime] = useState(
    module?.currentLesson.chapters[0]?.time ?? "00:00",
  );

  if (!module) {
    notFound();
  }

  const lesson = module.currentLesson;

  return (
    <div className="flex flex-col gap-6 py-6">
      {/* Header row: back + module title */}
      <div className="flex items-center gap-4">
        <Link
          href="/resources/learn-academy"
          className="flex h-8 w-8 cursor-pointer items-center justify-center rounded text-text-1 transition-colors hover:bg-bg-1"
          aria-label="Back to Learn Academy"
        >
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <h1 className="text-[26px] font-bold leading-[1.3] text-text-1">
          {module.title}
        </h1>
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[1fr_405px]">
        {/* Left column */}
        <div className="flex flex-col gap-6">
          <VideoPlayer
            lesson={lesson}
            lessonIndex={lesson.number}
            totalLessons={module.lessons}
          />

          {/* Example: Bad vs Enterprise-Grade Prompt */}
          <section className="flex items-center justify-between gap-4 rounded-lg border border-border-2 bg-bg-white p-6">
            <h3 className="text-[15px] font-semibold text-text-1">
              Example: Bad vs Enterprise-Grade Prompt
            </h3>
            <button
              type="button"
              className="cursor-pointer text-[12px] font-medium text-text-2 hover:text-primary-6 hover:underline"
            >
              Show Comparison
            </button>
          </section>

          {/* Interactive Exercise */}
          <section className="flex items-center justify-between gap-4 rounded-lg border border-border-2 bg-bg-white p-6">
            <h3 className="text-[15px] font-semibold text-text-1">
              Interactive Exercise
            </h3>
            <Button className="cursor-pointer bg-primary-7 hover:bg-primary-7/90">
              Try Exercise
            </Button>
          </section>
        </div>

        {/* Right column */}
        <aside className="flex flex-col gap-6">
          <ChapterMarkers
            lesson={lesson}
            activeTime={activeTime}
            onSelect={setActiveTime}
          />
          <Transcript lesson={lesson} />
          <Resources lesson={lesson} />
        </aside>
      </div>
    </div>
  );
}
