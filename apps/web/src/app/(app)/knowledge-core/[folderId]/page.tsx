"use client";

import { use, useMemo, useState } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ArrowLeft,
  FileText,
  Folder,
  MoreVertical,
  Search,
  Upload,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface FolderFile {
  name: string;
  type: string;
  size: string;
  uploadedBy: string;
  date: string;
}

interface FolderDetail {
  id: string;
  name: string;
  fileCount: number;
  totalSize: string;
  lastModified: string;
  files: FolderFile[];
}

const TYPE_STYLES: Record<string, string> = {
  PDF: "bg-[#FFECE8] text-[#F53F3F]",
  DOCX: "bg-[#EBF8FF] text-[#0369A1]",
  XLSX: "bg-[#E8FFEA] text-[#009A29]",
};

const FOLDER_DATA: Record<string, FolderDetail> = {
  "1": {
    id: "1",
    name: "Project Case Studies",
    fileCount: 12,
    totalSize: "45.2 MB",
    lastModified: "Mar 11, 2026",
    files: [
      { name: "AWS-Migration-Case-Study.pdf", type: "PDF", size: "3.2 MB", uploadedBy: "Sarah Johnson", date: "Mar 11, 2026 10:24 AM" },
      { name: "Azure-Cloud-Implementation.pdf", type: "PDF", size: "4.1 MB", uploadedBy: "Michael Chen", date: "Mar 10, 2026 2:15 PM" },
      { name: "ERP-System-Deployment.docx", type: "DOCX", size: "2.8 MB", uploadedBy: "Emily Rodriguez", date: "Mar 9, 2026 11:30 AM" },
      { name: "Digital-Transformation-Initiative.pdf", type: "PDF", size: "5.5 MB", uploadedBy: "David Kim", date: "Mar 8, 2026 4:45 PM" },
      { name: "Procurement-Automation-Success.pdf", type: "PDF", size: "3.9 MB", uploadedBy: "Sarah Johnson", date: "Mar 7, 2026 9:20 AM" },
      { name: "Supply-Chain-Optimization.xlsx", type: "XLSX", size: "1.7 MB", uploadedBy: "James Wilson", date: "Mar 6, 2026 3:10 PM" },
      { name: "Vendor-Management-Strategy.pdf", type: "PDF", size: "4.3 MB", uploadedBy: "Lisa Martinez", date: "Mar 5, 2026 10:55 AM" },
      { name: "Contract-Lifecycle-Management.pdf", type: "PDF", size: "3.6 MB", uploadedBy: "Robert Taylor", date: "Mar 4, 2026 1:40 PM" },
      { name: "Risk-Assessment-Framework.pdf", type: "PDF", size: "2.9 MB", uploadedBy: "Jennifer Lee", date: "Mar 3, 2026 11:25 AM" },
      { name: "Compliance-Audit-Report.pdf", type: "PDF", size: "4.7 MB", uploadedBy: "Thomas Anderson", date: "Mar 2, 2026 2:50 PM" },
      { name: "Cost-Reduction-Analysis.xlsx", type: "XLSX", size: "2.1 MB", uploadedBy: "Amanda White", date: "Mar 1, 2026 9:15 AM" },
      { name: "Strategic-Sourcing-Guide.pdf", type: "PDF", size: "3.4 MB", uploadedBy: "Christopher Brown", date: "Feb 28, 2026 4:30 PM" },
    ],
  },
  "2": {
    id: "2",
    name: "CVs/Resumes",
    fileCount: 28,
    totalSize: "8.3 MB",
    lastModified: "Mar 10, 2026",
    files: [
      { name: "Senior-Engineer-CV.pdf", type: "PDF", size: "245 KB", uploadedBy: "HR Department", date: "Mar 10, 2026 4:32 PM" },
    ],
  },
  "3": {
    id: "3",
    name: "Professional Certificates",
    fileCount: 15,
    totalSize: "12.7 MB",
    lastModified: "Mar 9, 2026",
    files: [
      { name: "ISO-27001-Certificate.pdf", type: "PDF", size: "1.1 MB", uploadedBy: "John Doe", date: "Mar 11, 2026 09:15 AM" },
    ],
  },
  "4": {
    id: "4",
    name: "IT Stack Documentation",
    fileCount: 34,
    totalSize: "67.8 MB",
    lastModified: "Mar 8, 2026",
    files: [],
  },
};

export default function FolderDetailPage({
  params,
}: {
  params: Promise<{ folderId: string }>;
}) {
  const { folderId } = use(params);
  const [query, setQuery] = useState("");

  const folder = FOLDER_DATA[folderId];
  if (!folder) notFound();

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return folder.files;
    return folder.files.filter(
      (f) =>
        f.name.toLowerCase().includes(q) ||
        f.uploadedBy.toLowerCase().includes(q) ||
        f.type.toLowerCase().includes(q),
    );
  }, [query, folder.files]);

  return (
    <div className="flex flex-col gap-6 py-6">
      {/* Back link */}
      <Link
        href="/knowledge-core"
        className="inline-flex w-fit cursor-pointer items-center gap-1.5 text-[14px] text-text-2 hover:text-primary-6"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to Folders
      </Link>

      {/* Folder info card */}
      <div className="flex flex-col gap-4 rounded-lg border border-border-2 bg-bg-white p-6 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-4">
          <Folder className="h-10 w-10 shrink-0 text-primary-6" strokeWidth={1.5} />
          <div className="flex flex-col">
            <h1 className="text-[20px] font-bold text-text-1">{folder.name}</h1>
            <div className="flex flex-wrap items-center gap-3 text-[13px] text-text-3">
              <span>{folder.fileCount} files</span>
              <span>{folder.totalSize} total</span>
              <span>Last modified {folder.lastModified}</span>
            </div>
          </div>
        </div>
        <Button className="shrink-0 cursor-pointer gap-2 bg-primary-6 hover:bg-primary-7">
          <Upload className="h-4 w-4" />
          Upload Files
        </Button>
      </div>

      {/* Search */}
      <div className="relative sm:max-w-xs">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-3" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search files..."
          className="h-10 pl-9 placeholder:text-text-3"
        />
      </div>

      {/* Files table */}
      <div className="overflow-hidden rounded-lg border border-border-2 bg-bg-white">
        {/* Desktop table */}
        <div className="hidden overflow-x-auto md:block">
          <table className="w-full text-left text-[13px]">
            <thead>
              <tr className="border-b border-border-2 text-[12px] font-semibold uppercase tracking-wide text-text-3">
                <th className="px-5 py-3">Name</th>
                <th className="px-5 py-3">Type</th>
                <th className="px-5 py-3">Size</th>
                <th className="px-5 py-3">Uploaded By</th>
                <th className="px-5 py-3">Date</th>
                <th className="px-5 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((f) => (
                <tr
                  key={f.name}
                  className="border-b border-border-2 last:border-b-0 transition-colors hover:bg-bg-1"
                >
                  <td className="px-5 py-4">
                    <div className="flex items-center gap-3">
                      <FileText className="h-5 w-5 shrink-0 text-text-3" strokeWidth={1.5} />
                      <span className="font-medium text-text-1">{f.name}</span>
                    </div>
                  </td>
                  <td className="px-5 py-4">
                    <span
                      className={`inline-flex rounded px-2 py-0.5 text-[11px] font-semibold ${TYPE_STYLES[f.type] ?? "bg-bg-1 text-text-2"}`}
                    >
                      {f.type}
                    </span>
                  </td>
                  <td className="px-5 py-4 text-text-2">{f.size}</td>
                  <td className="px-5 py-4 text-text-2">{f.uploadedBy}</td>
                  <td className="px-5 py-4 text-text-3">{f.date}</td>
                  <td className="px-5 py-4">
                    <button
                      type="button"
                      className="flex h-6 w-6 cursor-pointer items-center justify-center rounded text-text-3 hover:bg-bg-1 hover:text-text-1"
                    >
                      <MoreVertical className="h-4 w-4" />
                    </button>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td
                    colSpan={6}
                    className="px-5 py-10 text-center text-[13px] text-text-3"
                  >
                    No files match your search.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Mobile cards */}
        <div className="flex flex-col md:hidden">
          {filtered.map((f, idx) => (
            <div
              key={f.name}
              className={`flex flex-col gap-2 px-4 py-4 ${idx > 0 ? "border-t border-border-2" : ""}`}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2">
                  <FileText className="h-5 w-5 shrink-0 text-text-3" strokeWidth={1.5} />
                  <span className="text-[14px] font-medium text-text-1">
                    {f.name}
                  </span>
                </div>
                <span
                  className={`shrink-0 rounded px-2 py-0.5 text-[11px] font-semibold ${TYPE_STYLES[f.type] ?? "bg-bg-1 text-text-2"}`}
                >
                  {f.type}
                </span>
              </div>
              <div className="flex flex-wrap gap-2 text-[12px] text-text-3">
                <span>{f.size}</span>
                <span>•</span>
                <span>{f.uploadedBy}</span>
                <span>•</span>
                <span>{f.date}</span>
              </div>
            </div>
          ))}
          {filtered.length === 0 && (
            <p className="py-8 text-center text-[13px] text-text-3">
              No files match your search.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
