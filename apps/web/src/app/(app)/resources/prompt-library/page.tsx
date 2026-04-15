"use client";

import { useMemo, useState } from "react";
import {
  Search,
  ChevronDown,
  Copy,
  CheckCircle2,
  FileText,
} from "lucide-react";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface Prompt {
  title: string;
  description: string;
  accuracy: number;
  category: string;
  tags: string[];
  example: string;
  promptText: string;
}

const PROMPTS: Prompt[] = [
  {
    title: "RFP Bid/No-Bid Analysis",
    description:
      "Comprehensive evaluation framework for RFP opportunities with scoring and recommendation",
    accuracy: 95,
    category: "Strategic Analysis",
    tags: ["RFP", "Decision Making", "Strategic"],
    example: "Upload RFP document → Get structured bid recommendation",
    promptText:
      "You are an expert procurement strategist. Analyze the attached RFP and produce a structured bid/no-bid recommendation...",
  },
  {
    title: "Vendor Proposal Comparison",
    description:
      "Side-by-side analysis of multiple vendor proposals with scoring matrix",
    accuracy: 92,
    category: "Vendor Management",
    tags: ["Vendor", "Comparison", "Evaluation"],
    example: "Upload 2-5 vendor proposals → Get comparison matrix",
    promptText:
      "You are a senior procurement analyst. Compare the attached vendor proposals side by side...",
  },
  {
    title: "Structured Data Extraction",
    description:
      "Extract and structure data from unstructured documents into JSON/CSV format",
    accuracy: 90,
    category: "Data Processing",
    tags: ["Data", "Extraction", "Automation"],
    example: "Upload document → Get structured data output",
    promptText:
      "Extract the following fields from the supplied document and return JSON matching the schema...",
  },
  {
    title: "Legal Document Summarization",
    description:
      "Extract key legal terms, obligations, and risks from contracts and agreements",
    accuracy: 88,
    category: "Legal & Compliance",
    tags: ["Legal", "Contracts", "Compliance"],
    example: "Paste contract text → Get structured legal summary",
    promptText:
      "You are a legal analyst. Summarize the attached contract covering key obligations, risks, and deadlines...",
  },
  {
    title: "Cost Breakdown Analysis",
    description:
      "Detailed financial analysis of quotes, proposals, and pricing structures",
    accuracy: 85,
    category: "Financial Analysis",
    tags: ["Finance", "Pricing", "TCO"],
    example: "Paste pricing document → Get TCO analysis",
    promptText:
      "You are a financial analyst. Produce a total cost of ownership breakdown for the attached pricing document...",
  },
  {
    title: "Risk Identification & Mitigation",
    description:
      "Identify potential risks in proposals, contracts, and procurement decisions",
    accuracy: 82,
    category: "Strategic Analysis",
    tags: ["Risk", "Mitigation", "Strategic"],
    example: "Upload proposal → Get risk matrix",
    promptText:
      "Identify and categorize risks in the attached proposal, then suggest mitigations prioritized by impact...",
  },
  {
    title: "Compliance & Risk Assessment",
    description:
      "Verify regulatory compliance and identify potential risks in documents",
    accuracy: 78,
    category: "Legal & Compliance",
    tags: ["Compliance", "Risk", "Regulatory"],
    example: "Upload compliance document → Get risk assessment",
    promptText:
      "You are a compliance officer. Check the attached document against the listed regulations...",
  },
  {
    title: "Project Timeline Assessment",
    description:
      "Evaluate project schedules, identify dependencies, and assess feasibility",
    accuracy: 72,
    category: "Strategic Analysis",
    tags: ["Timeline", "Project Management", "Planning"],
    example: "Paste project plan → Get timeline analysis",
    promptText:
      "Analyze the attached project plan for critical path, dependencies, and schedule risks...",
  },
];

const ALL_CATEGORIES = Array.from(new Set(PROMPTS.map((p) => p.category)));

function AccuracyPill({ value }: { value: number }) {
  return (
    <span className="inline-flex items-center gap-1 rounded bg-bg-white border border-border-2 px-2 py-1 text-[11px] font-medium text-text-2">
      <CheckCircle2 className="h-3 w-3 text-primary-6" strokeWidth={2.5} />
      {value}%
    </span>
  );
}

export default function PromptLibraryPage() {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<string>("all");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return PROMPTS.filter((p) => {
      if (category !== "all" && p.category !== category) return false;
      if (!q) return true;
      return (
        p.title.toLowerCase().includes(q) ||
        p.description.toLowerCase().includes(q) ||
        p.tags.some((t) => t.toLowerCase().includes(q))
      );
    });
  }, [query, category]);

  const handleCopy = async (prompt: Prompt) => {
    try {
      await navigator.clipboard.writeText(prompt.promptText);
      toast.success(`Copied "${prompt.title}" to clipboard.`);
    } catch {
      toast.error("Couldn't copy to clipboard.");
    }
  };

  return (
    <div className="flex flex-col gap-6 py-6">
      {/* Toolbar */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-6">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-text-3" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search"
            className="h-11 pl-9 pr-3 text-base rounded-md border-border-2 placeholder:text-text-3"
          />
        </div>
        <Select value={category} onValueChange={setCategory}>
          <SelectTrigger className="h-11 w-full sm:w-[198px] rounded-md border-border-2 text-base">
            <SelectValue placeholder="All" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All</SelectItem>
            {ALL_CATEGORIES.map((c) => (
              <SelectItem key={c} value={c}>
                {c}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* List */}
      <div className="flex flex-col gap-4">
        {filtered.map((p) => (
          <article
            key={p.title}
            className="flex gap-4 rounded-lg border border-border-2 bg-bg-white p-5"
          >
            {/* Thumbnail tile */}
            <div className="hidden shrink-0 items-center justify-center self-stretch rounded-lg bg-[#3C7EFF]/20 sm:flex sm:w-[96px]">
              <FileText className="h-8 w-8 text-primary-7" strokeWidth={2} />
            </div>

            {/* Content */}
            <div className="flex min-w-0 flex-1 flex-col gap-3">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex min-w-0 flex-col gap-1">
                  <h3 className="text-base font-bold leading-snug text-text-1">
                    {p.title}
                  </h3>
                  <p className="text-[13px] leading-snug text-text-2">
                    {p.description}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <AccuracyPill value={p.accuracy} />
                  <button
                    type="button"
                    onClick={() => handleCopy(p)}
                    className="inline-flex h-9 items-center gap-2 rounded bg-primary-6 px-4 text-[13px] font-medium text-text-white transition-colors hover:bg-primary-7"
                  >
                    <Copy className="h-4 w-4" />
                    Copy Prompt
                  </button>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded bg-[#EBF8FF] px-2.5 py-1 text-[11px] font-medium text-text-2">
                  {p.category}
                </span>
                {p.tags.map((t) => (
                  <span
                    key={t}
                    className="rounded border border-border-2 bg-bg-white px-2.5 py-1 text-[11px] font-normal text-text-2"
                  >
                    {t}
                  </span>
                ))}
              </div>

              <div className="flex items-center gap-1.5">
                <span className="inline-block h-1 w-1 rounded-full bg-primary-7" />
                <span className="text-[12px] text-text-2">
                  Example: {p.example}
                </span>
              </div>

              <button
                type="button"
                onClick={() =>
                  toast.info("Full prompt view is coming soon.")
                }
                className="inline-flex self-start items-center gap-1 text-[13px] font-medium text-primary-6 hover:text-primary-7 hover:underline"
              >
                View Full Prompt
                <ChevronDown className="h-3.5 w-3.5 -rotate-90" />
              </button>
            </div>
          </article>
        ))}

        {filtered.length === 0 && (
          <div className="rounded-lg border border-border-2 bg-bg-white p-10 text-center text-sm text-text-3">
            No prompts match your search.
          </div>
        )}
      </div>
    </div>
  );
}
