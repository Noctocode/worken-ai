"use client";

import { use, useState } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ArrowLeft,
  Building2,
  Calendar,
  ChevronRight,
  Download,
  FileSpreadsheet,
  FileText,
  Info,
  Share2,
  Sparkles,
} from "lucide-react";
import { Button } from "@/components/ui/button";

type ReqStatus = "met" | "partial" | "gap";

interface Requirement {
  code: string;
  status: ReqStatus;
  title: string;
  evidence: string;
  source: string;
}

interface Document {
  badge: string;
  badgeColor: string;
  name: string;
  size: string;
  date: string;
}

interface Activity {
  person: string;
  action: string;
  time: string;
}

interface ActionTip {
  priority: "High" | "Medium";
  title: string;
  description: string;
}

interface TenderDetail {
  id: string;
  code: string;
  name: string;
  organization: string;
  deadline: string;
  matchRate: number;
  matchLabel: string;
  met: number;
  partial: number;
  gaps: number;
  overview: string;
  requirements: Requirement[];
  documents: Document[];
  activities: Activity[];
  tips: ActionTip[];
}

const TENDER_DETAIL: TenderDetail = {
  id: "1",
  code: "TND-2026-001",
  name: "Enterprise Cloud Migration Services",
  organization: "Federal Aviation Administration",
  deadline: "Due Mar 25, 2026",
  matchRate: 65,
  matchLabel: "Strong match for tender requirements",
  met: 2,
  partial: 1,
  gaps: 3,
  overview:
    "Comprehensive cloud migration services for legacy government systems to AWS GovCloud infrastructure. Project includes assessment, migration planning, execution, and post-migration support for 45+ applications across 12 departments.",
  requirements: [
    {
      code: "REQ-001",
      status: "met",
      title:
        "AWS Certified Solutions Architect — Professional (minimum 3 team members)",
      evidence:
        "Sarah Mitchell, James Chen, David Park all certified",
      source: "Team Certifications",
    },
    {
      code: "REQ-002",
      status: "partial",
      title: "FedRAMP High certification or ability to obtain within 90 days",
      evidence:
        "Application submitted, pending review (Est. 45 days)",
      source: "Compliance Database",
    },
    {
      code: "REQ-003",
      status: "gap",
      title:
        "Demonstrated experience with government cloud migrations (minimum 5 projects)",
      evidence:
        "Only 2 federal migrations documented — need 3 more reference projects",
      source: "Past Performance",
    },
    {
      code: "REQ-004",
      status: "gap",
      title: "CMMI Level 3 or higher maturity rating",
      evidence:
        "Currently Level 2 — assessment scheduled for Q2 2026",
      source: "Certifications",
    },
    {
      code: "REQ-005",
      status: "met",
      title: "24/7 support capability with 99.9% SLA",
      evidence:
        "SOC 2 Type II certified with proven 99.95% uptime",
      source: "Service Capabilities",
    },
    {
      code: "REQ-006",
      status: "gap",
      title: "Security clearance for all personnel (Secret level minimum)",
      evidence:
        "12 of 15 personnel cleared, 3 applications in progress",
      source: "HR Records",
    },
  ],
  documents: [
    {
      badge: "PDF",
      badgeColor: "bg-[#FFECE8] text-[#F53F3F]",
      name: "RFP_FAA_Cloud_Migration_2026.pdf",
      size: "2.4 MB",
      date: "Feb 15, 2026",
    },
    {
      badge: "DOC",
      badgeColor: "bg-[#EBF8FF] text-[#0369A1]",
      name: "Technical_Proposal_Draft_v3.docx",
      size: "1.8 MB",
      date: "Mar 10, 2026",
    },
    {
      badge: "PDF",
      badgeColor: "bg-[#FFECE8] text-[#F53F3F]",
      name: "Team_Certifications.pdf",
      size: "3.1 MB",
      date: "Mar 05, 2026",
    },
    {
      badge: "XLS",
      badgeColor: "bg-[#E8FFEA] text-[#009A29]",
      name: "Cost_Breakdown_Analysis.xlsx",
      size: "524 KB",
      date: "Mar 08, 2026",
    },
  ],
  activities: [
    {
      person: "Sarah Mitchell",
      action: "Updated requirement matching for REQ-002",
      time: "2 hours ago",
    },
    {
      person: "James Chen",
      action: "Added AWS architecture diagrams to technical proposal",
      time: "5 hours ago",
    },
    {
      person: "Maria Rodriguez",
      action: "Completed security compliance checklist",
      time: "1 day ago",
    },
  ],
  tips: [
    {
      priority: "High",
      title: "Obtain CMMI Level 3 Certification",
      description:
        "Schedule formal assessment with CMMI Institute. Current timeline shows Q2 2026 completion.",
    },
    {
      priority: "High",
      title: "Complete Security Clearances",
      description:
        "Expedite 3 pending clearance applications. Coordinate with Defense Security Service.",
    },
    {
      priority: "Medium",
      title: "Finalize FedRAMP Certification",
      description:
        "Follow up with FedRAMP PMO on application status. Prepare for JAB review.",
    },
  ],
};

const REQ_STATUS_STYLES: Record<
  ReqStatus,
  { badge: string; label: string }
> = {
  met: { badge: "bg-[#E8FFEA] text-[#009A29]", label: "Met" },
  partial: { badge: "bg-[#FFF7E8] text-[#D25F00]", label: "Partial" },
  gap: { badge: "bg-[#FFECE8] text-[#F53F3F]", label: "Gap" },
};

type ReqFilter = "all" | ReqStatus;

export default function TenderDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const [reqFilter, setReqFilter] = useState<ReqFilter>("all");

  // For now all IDs use the same mock detail
  if (!id) notFound();
  const tender = TENDER_DETAIL;

  const filteredReqs =
    reqFilter === "all"
      ? tender.requirements
      : tender.requirements.filter((r) => r.status === reqFilter);

  const filterTabs: { value: ReqFilter; label: string; count: number }[] = [
    { value: "all", label: "All", count: tender.requirements.length },
    {
      value: "met",
      label: "Met",
      count: tender.requirements.filter((r) => r.status === "met").length,
    },
    {
      value: "partial",
      label: "Partial",
      count: tender.requirements.filter((r) => r.status === "partial").length,
    },
    {
      value: "gap",
      label: "Gaps",
      count: tender.requirements.filter((r) => r.status === "gap").length,
    },
  ];

  return (
    <div className="flex flex-col gap-6 py-6">
      {/* Mobile-only breadcrumb + actions (desktop lives in appbar) */}
      <div className="flex flex-col gap-3 sm:hidden">
        <div className="flex items-center gap-3 text-[14px] text-text-2">
          <Link
            href="/tender-ai"
            className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-md bg-bg-1 text-text-1 transition-colors hover:bg-border-2"
          >
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <Link
            href="/tender-ai"
            className="cursor-pointer hover:text-primary-6"
          >
            Dashboard
          </Link>
          <ChevronRight className="h-3.5 w-3.5 text-text-3" />
          <span className="font-medium text-text-1">{tender.code}</span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            className="cursor-pointer gap-2 text-[13px]"
          >
            <Download className="h-3.5 w-3.5" />
            Download PDF
          </Button>
          <Button
            variant="outline"
            className="cursor-pointer gap-2 text-[13px]"
          >
            <FileSpreadsheet className="h-3.5 w-3.5" />
            Export CSV
          </Button>
          <Button className="cursor-pointer gap-2 bg-primary-6 text-[13px] hover:bg-primary-7">
            <Share2 className="h-3.5 w-3.5" />
            Share with Team
          </Button>
        </div>
      </div>

      {/* Two-column layout */}
      <div className="flex flex-col gap-6 xl:flex-row xl:gap-8">
        {/* Left column */}
        <div className="flex min-w-0 flex-1 flex-col gap-6">
          {/* Title card */}
          <section>
            <h1 className="text-[26px] font-bold leading-tight text-text-1 sm:text-[26px]">
              {tender.name}
            </h1>
            <div className="mt-2 flex flex-wrap items-center gap-4 text-[14px] text-text-2">
              <span className="inline-flex items-center gap-1.5">
                <Building2 className="h-4 w-4" />
                {tender.organization}
              </span>
              <span className="inline-flex items-center gap-1.5">
                <Calendar className="h-4 w-4" />
                {tender.deadline}
              </span>
            </div>
          </section>

          {/* Match Rate */}
          <section className="flex items-center justify-between gap-6 rounded-lg bg-bg-1 p-6">
            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-2">
                <span className="flex h-8 w-8 items-center justify-center rounded-md bg-[rgba(60,126,255,0.2)]">
                  <Sparkles className="h-4 w-4 text-primary-6" />
                </span>
                <span className="text-[14px] text-text-2">
                  AI Match Rate Analysis
                </span>
              </div>
              <span className="text-[42px] font-bold leading-none text-text-1">
                {tender.matchRate}%
              </span>
              <span className="text-[14px] text-text-2">
                {tender.matchLabel}
              </span>
              <div className="mt-1 flex flex-wrap items-center gap-4 text-[13px]">
                <span className="inline-flex items-center gap-1.5">
                  <span className="h-2.5 w-2.5 rounded-full bg-[#00B42A]" />
                  {tender.met} Met
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <span className="h-2.5 w-2.5 rounded-full bg-[#D25F00]" />
                  {tender.partial} Partial
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <span className="h-2.5 w-2.5 rounded-full bg-[#F53F3F]" />
                  {tender.gaps} Gaps
                </span>
              </div>
            </div>
            {/* Donut chart */}
            <div className="hidden shrink-0 sm:block">
              <svg
                width="144"
                height="144"
                viewBox="0 0 144 144"
                className="sm:h-36 sm:w-36"
              >
                <circle
                  cx="72"
                  cy="72"
                  r="56"
                  fill="none"
                  stroke="#E5E6EB"
                  strokeWidth="16"
                />
                <circle
                  cx="72"
                  cy="72"
                  r="56"
                  fill="none"
                  stroke="#178ACA"
                  strokeWidth="16"
                  strokeDasharray={`${(tender.matchRate / 100) * 2 * Math.PI * 56} ${2 * Math.PI * 56}`}
                  strokeLinecap="round"
                  transform="rotate(-90 72 72)"
                />
                <text
                  x="72"
                  y="66"
                  textAnchor="middle"
                  className="fill-text-1 text-[24px] font-bold"
                >
                  {tender.matchRate}%
                </text>
                <text
                  x="72"
                  y="86"
                  textAnchor="middle"
                  className="fill-text-2 text-[12px]"
                >
                  Match
                </text>
              </svg>
            </div>
          </section>

          {/* Overview */}
          <section className="flex flex-col gap-3">
            <h2 className="text-[18px] font-bold text-text-1">Overview</h2>
            <p className="text-[14px] leading-[1.6] text-text-2">
              {tender.overview}
            </p>
          </section>

          {/* Requirement Match */}
          <section className="flex flex-col gap-4">
            <h2 className="text-[18px] font-bold text-text-1">
              Requirement Match
            </h2>
            {/* Filter tabs */}
            <div className="flex items-center gap-1 rounded-lg bg-[#F2F3F5] p-1">
              {filterTabs.map((tab) => (
                <button
                  key={tab.value}
                  type="button"
                  onClick={() => setReqFilter(tab.value)}
                  className={`cursor-pointer rounded-md px-3 py-1.5 text-[13px] font-medium transition-all ${
                    reqFilter === tab.value
                      ? "bg-bg-white text-text-1 shadow-sm"
                      : "text-text-2 hover:text-text-1"
                  }`}
                >
                  {tab.label} ({tab.count})
                </button>
              ))}
            </div>
            {/* Requirement cards */}
            <div className="flex flex-col gap-3">
              {filteredReqs.map((req) => {
                const style = REQ_STATUS_STYLES[req.status];
                return (
                  <div
                    key={req.code}
                    className="flex flex-col gap-3 rounded-lg border border-[#F2F3F5] p-4"
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-[12px] text-text-3">
                        {req.code}
                      </span>
                      <span
                        className={`rounded px-2 py-0.5 text-[11px] font-semibold ${style.badge}`}
                      >
                        {style.label}
                      </span>
                    </div>
                    <p className="text-[14px] font-medium text-text-1">
                      {req.title}
                    </p>
                    <div className="flex items-start gap-2 rounded bg-bg-1 p-3">
                      <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-text-3" />
                      <span className="text-[13px] text-text-2">
                        {req.evidence}
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5 text-[12px] text-text-3">
                      <FileText className="h-3 w-3" />
                      Source: {req.source}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>

          {/* Documents */}
          <section className="flex flex-col gap-4">
            <h2 className="text-[18px] font-bold text-text-1">Documents</h2>
            <div className="flex flex-col gap-2">
              {tender.documents.map((doc) => (
                <div
                  key={doc.name}
                  className="flex cursor-pointer items-center gap-3 rounded-lg border border-[#F2F3F5] p-3 transition-colors hover:bg-bg-1"
                >
                  <span
                    className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-md text-[11px] font-bold ${doc.badgeColor}`}
                  >
                    {doc.badge}
                  </span>
                  <div className="flex min-w-0 flex-col">
                    <span className="truncate text-[14px] font-medium text-text-1">
                      {doc.name}
                    </span>
                    <span className="text-[12px] text-text-3">
                      {doc.size} · {doc.date}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </section>

          {/* Activity History */}
          <section className="flex flex-col gap-4">
            <h2 className="text-[18px] font-bold text-text-1">
              Activity History
            </h2>
            <div className="flex flex-col">
              {tender.activities.map((a, i) => (
                <div key={i} className="flex gap-3">
                  {/* Timeline connector */}
                  <div className="flex flex-col items-center">
                    <span className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full bg-primary-6" />
                    {i < tender.activities.length - 1 && (
                      <span className="w-px flex-1 bg-primary-6/30" />
                    )}
                  </div>
                  <div className="flex flex-col gap-0.5 pb-6">
                    <p className="text-[14px] text-text-1">
                      <span className="font-semibold">{a.person}</span>{" "}
                      {a.action}
                    </p>
                    <span className="text-[12px] text-text-3">{a.time}</span>
                  </div>
                </div>
              ))}
            </div>
          </section>
        </div>

        {/* Right column — AI Tips */}
        <aside className="w-full shrink-0 xl:w-[374px]">
          <div className="sticky top-24 flex flex-col gap-4 rounded-lg border border-[#F2F3F5] bg-bg-white p-5 shadow-[0_1px_2px_-1px_rgba(0,0,0,0.1),_0_1px_3px_0_rgba(0,0,0,0.1)] xl:bg-bg-white">
            <div className="flex items-center gap-2">
              <span className="h-2.5 w-2.5 rounded-full bg-[#33AFF3]" />
              <h2 className="text-[18px] font-bold text-text-1">
                AI-Generated Action Tips
              </h2>
            </div>
            <p className="text-[13px] text-text-2">
              Critical actions to improve tender match rate
            </p>
            <div className="flex flex-col gap-3">
              {tender.tips.map((tip, i) => {
                const isHigh = tip.priority === "High";
                return (
                  <div
                    key={i}
                    className="flex flex-col gap-1.5 rounded-lg bg-bg-white p-3 shadow-[0_1px_2px_rgba(0,0,0,0.05)]"
                  >
                    <span
                      className={`inline-flex w-fit items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                        isHigh
                          ? "bg-[#FFECE8] text-[#CB272D]"
                          : "bg-[#FFF7E8] text-[#D25F00]"
                      }`}
                    >
                      <span
                        className={`h-1.5 w-1.5 rounded-full ${
                          isHigh ? "bg-[#CB272D]" : "bg-[#FF9A2E]"
                        }`}
                      />
                      {tip.priority} Priority
                    </span>
                    <h3 className="text-[14px] font-semibold text-text-1">
                      {tip.title}
                    </h3>
                    <p className="text-[13px] leading-[1.5] text-text-2">
                      {tip.description}
                    </p>
                  </div>
                );
              })}
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
