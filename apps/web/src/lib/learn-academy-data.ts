import {
  Sparkles,
  FileSearch,
  Database,
  Shield,
  Settings2,
  type LucideIcon,
} from "lucide-react";

export type Difficulty = "Beginner" | "Intermediate" | "Advanced";

export interface LessonChapter {
  time: string;
  title: string;
  duration: string;
}

export interface LessonTranscript {
  time: string;
  text: string;
}

export interface LessonResource {
  label: string;
  kind: "pdf" | "code" | "link";
}

export interface Lesson {
  number: number;
  title: string;
  description: string;
  duration: string;
  chapters: LessonChapter[];
  transcript: LessonTranscript[];
  resources: LessonResource[];
}

export interface Module {
  slug: string;
  title: string;
  description: string;
  difficulty: Difficulty;
  icon: LucideIcon;
  progress: number;
  duration: string;
  lessons: number;
  lastAt: string;
  currentLesson: Lesson;
}

const PROMPT_ENGINEERING_101_LESSON: Lesson = {
  number: 1,
  title: "Introduction to Prompt Engineering",
  description:
    "Learn the foundational principles of crafting effective prompts for enterprise AI systems",
  duration: "18:45",
  chapters: [
    { time: "00:00", title: "Introduction", duration: "2:15" },
    { time: "02:15", title: "What is Prompt Engineering?", duration: "5:30" },
    { time: "07:45", title: "Key Components of Effective Prompts", duration: "6:00" },
    { time: "13:45", title: "Enterprise Best Practices", duration: "5:00" },
  ],
  transcript: [
    {
      time: "00:00",
      text: "Welcome to Prompt Engineering 101. In this course, we'll explore the fundamental principles of crafting effective prompts for enterprise AI applications.",
    },
    {
      time: "00:15",
      text: "Prompt engineering is the practice of designing and refining input instructions to guide AI models toward producing desired outputs with high accuracy and reliability.",
    },
    {
      time: "00:35",
      text: "In enterprise environments, well-crafted prompts are critical for ensuring consistent quality, maintaining security, and achieving business objectives...",
    },
  ],
  resources: [
    { label: "Lesson Slides (PDF)", kind: "pdf" },
    { label: "Code Examples", kind: "code" },
    { label: "Additional Reading", kind: "link" },
  ],
};

const GENERIC_LESSON = (title: string, description: string): Lesson => ({
  number: 1,
  title,
  description,
  duration: "15:00",
  chapters: [
    { time: "00:00", title: "Introduction", duration: "3:00" },
    { time: "03:00", title: "Core Concepts", duration: "6:00" },
    { time: "09:00", title: "Practical Examples", duration: "4:00" },
    { time: "13:00", title: "Summary", duration: "2:00" },
  ],
  transcript: [
    { time: "00:00", text: `Welcome to ${title}. ${description}` },
    {
      time: "00:20",
      text: "In this lesson we'll work through the fundamentals and apply them to a concrete enterprise scenario.",
    },
  ],
  resources: [
    { label: "Lesson Slides (PDF)", kind: "pdf" },
    { label: "Code Examples", kind: "code" },
    { label: "Additional Reading", kind: "link" },
  ],
});

export const MODULES: Module[] = [
  {
    slug: "prompt-engineering-101",
    title: "Prompt Engineering 101",
    description:
      "Master the fundamentals of crafting effective prompts for enterprise AI applications",
    difficulty: "Beginner",
    icon: Sparkles,
    progress: 65,
    duration: "2h 15m",
    lessons: 8,
    lastAt: "2 days ago",
    currentLesson: PROMPT_ENGINEERING_101_LESSON,
  },
  {
    slug: "advanced-tender-analysis",
    title: "Advanced Tender Analysis",
    description:
      "Learn techniques for analyzing complex RFPs and generating competitive bid strategies",
    difficulty: "Advanced",
    icon: FileSearch,
    progress: 30,
    duration: "3h 45m",
    lessons: 12,
    lastAt: "1 week ago",
    currentLesson: GENERIC_LESSON(
      "RFP Fundamentals",
      "Understand how enterprise RFPs are structured and what evaluators look for.",
    ),
  },
  {
    slug: "structured-data-extraction",
    title: "Structured Data Extraction",
    description:
      "Extract and structure information from unstructured documents with precision",
    difficulty: "Intermediate",
    icon: Database,
    progress: 100,
    duration: "2h 30m",
    lessons: 10,
    lastAt: "3 days ago",
    currentLesson: GENERIC_LESSON(
      "Schemas & Field Mapping",
      "Define a target schema and map unstructured document fields into typed data.",
    ),
  },
  {
    slug: "ai-safety-compliance",
    title: "AI Safety & Compliance",
    description:
      "Ensure your prompts meet enterprise security and regulatory requirements",
    difficulty: "Intermediate",
    icon: Shield,
    progress: 0,
    duration: "1h 50m",
    lessons: 6,
    lastAt: "Never",
    currentLesson: GENERIC_LESSON(
      "Safety Constraints",
      "Apply safety and compliance constraints to every enterprise prompt.",
    ),
  },
  {
    slug: "prompt-optimization-strategies",
    title: "Prompt Optimization Strategies",
    description:
      "Advanced techniques for improving prompt quality, cost-efficiency, and performance",
    difficulty: "Advanced",
    icon: Settings2,
    progress: 45,
    duration: "3h 20m",
    lessons: 14,
    lastAt: "5 days ago",
    currentLesson: GENERIC_LESSON(
      "Evaluation Loops",
      "Build feedback loops that measure and iteratively improve prompt quality.",
    ),
  },
];

export function getModuleBySlug(slug: string): Module | undefined {
  return MODULES.find((m) => m.slug === slug);
}
