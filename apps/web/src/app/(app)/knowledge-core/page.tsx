"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  FileText,
  Folder,
  MoreVertical,
  Upload,
} from "lucide-react";

interface KnowledgeFolder {
  id: string;
  name: string;
  fileCount: number;
  size: string;
  modified: string;
}

interface RecentFile {
  id: string;
  name: string;
  folder: string;
  size: string;
  uploadedBy: string;
  date: string;
}

const FOLDERS: KnowledgeFolder[] = [
  {
    id: "1",
    name: "Project Case Studies",
    fileCount: 12,
    size: "45.2 MB",
    modified: "Modified Mar 11, 2026",
  },
  {
    id: "2",
    name: "CVs/Resumes",
    fileCount: 28,
    size: "8.3 MB",
    modified: "Modified Mar 10, 2026",
  },
  {
    id: "3",
    name: "Professional Certificates",
    fileCount: 15,
    size: "12.7 MB",
    modified: "Modified Mar 9, 2026",
  },
  {
    id: "4",
    name: "IT Stack Documentation",
    fileCount: 34,
    size: "67.8 MB",
    modified: "Modified Mar 8, 2026",
  },
];

const RECENT_FILES: RecentFile[] = [
  {
    id: "1",
    name: "AWS-Migration-Case-Study.pdf",
    folder: "Project Case Studies",
    size: "3.2 MB",
    uploadedBy: "Sarah Johnson",
    date: "Mar 11, 2026 10:24 AM",
  },
  {
    id: "2",
    name: "ISO-27001-Certificate.pdf",
    folder: "Professional Certificates",
    size: "1.1 MB",
    uploadedBy: "John Doe",
    date: "Mar 11, 2026 09:15 AM",
  },
  {
    id: "3",
    name: "Senior-Engineer-CV.pdf",
    folder: "CVs/Resumes",
    size: "245 KB",
    uploadedBy: "HR Department",
    date: "Mar 10, 2026 4:32 PM",
  },
];

export default function KnowledgeCorePage() {
  const [query, setQuery] = useState("");

  const handleSearch = useCallback((value: string) => {
    setQuery(value);
  }, []);

  useEffect(() => {
    const onSearch = (e: Event) =>
      handleSearch((e as CustomEvent<string>).detail);
    window.addEventListener("knowledge-core:search", onSearch);
    return () =>
      window.removeEventListener("knowledge-core:search", onSearch);
  }, [handleSearch]);

  const filteredFolders = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return FOLDERS;
    return FOLDERS.filter((f) => f.name.toLowerCase().includes(q));
  }, [query]);

  const filteredFiles = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return RECENT_FILES;
    return RECENT_FILES.filter(
      (f) =>
        f.name.toLowerCase().includes(q) ||
        f.folder.toLowerCase().includes(q) ||
        f.uploadedBy.toLowerCase().includes(q),
    );
  }, [query]);

  return (
    <div className="flex flex-col gap-6 py-6">
      {/* Upload dropzone */}
      <div className="flex flex-col items-center gap-4 rounded-lg border-2 border-dashed border-border-2 bg-bg-white px-12 py-12">
        <span className="flex h-12 w-12 items-center justify-center rounded-full bg-primary-6">
          <Upload className="h-6 w-6 text-white" />
        </span>
        <div className="flex flex-col items-center gap-1 text-center">
          <p className="text-[16px] font-medium text-text-1">
            Drag and drop files here, or click to browse
          </p>
          <p className="text-[13px] text-text-3">
            Supports PDF, DOCX, XLSX, PNG, JPG up to 50MB per file
          </p>
        </div>
        <label>
          <input
            type="file"
            multiple
            accept=".pdf,.docx,.xlsx,.doc,.xls,.png,.jpg,.jpeg"
            className="hidden"
          />
          <span className="inline-flex cursor-pointer items-center rounded border border-border-2 px-4 py-2 text-[13px] font-medium text-text-1 transition-colors hover:bg-bg-1">
            Browse Files
          </span>
        </label>
      </div>

      {/* Folders */}
      <section className="flex flex-col gap-4">
        <h2 className="text-[18px] font-bold text-text-1">Folders</h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {filteredFolders.map((folder) => (
            <div
              key={folder.id}
              className="flex cursor-pointer flex-col gap-3 rounded border border-border-2 bg-bg-white p-6 transition-colors hover:bg-[#EBF8FF]"
            >
              <div className="flex items-start justify-between">
                <Folder className="h-8 w-8 text-primary-6" strokeWidth={1.5} />
                <button
                  type="button"
                  className="flex h-6 w-6 cursor-pointer items-center justify-center rounded text-text-3 hover:bg-bg-1 hover:text-text-1"
                >
                  <MoreVertical className="h-4 w-4" />
                </button>
              </div>
              <h3 className="text-[16px] font-medium text-text-1">
                {folder.name}
              </h3>
              <div className="flex flex-col gap-1 text-[13px] text-text-3">
                <span>
                  {folder.fileCount} files • {folder.size}
                </span>
                <span>{folder.modified}</span>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Recent Files */}
      <section className="flex flex-col gap-4">
        <h2 className="text-[18px] font-bold text-text-1">Recent Files</h2>
        <div className="flex flex-col gap-3">
          {filteredFiles.map((file, idx) => (
            <div
              key={file.id}
              className={`flex cursor-pointer items-center gap-4 rounded border border-border-2 px-4 py-3 transition-colors hover:bg-[#EBF8FF] ${
                idx === 0 ? "bg-[#EBF8FF]" : "bg-bg-white"
              }`}
            >
              <FileText
                className="h-8 w-8 shrink-0 text-text-3"
                strokeWidth={1.5}
              />
              <div className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-[16px] font-medium text-text-1">
                  {file.name}
                </span>
                <span className="truncate text-[13px] text-text-3">
                  {file.folder} • {file.size} • Uploaded by {file.uploadedBy}
                </span>
              </div>
              <span className="hidden shrink-0 text-[13px] text-text-3 sm:block">
                {file.date}
              </span>
              <button
                type="button"
                className="flex h-6 w-6 shrink-0 cursor-pointer items-center justify-center rounded text-text-3 hover:bg-bg-1 hover:text-text-1"
              >
                <MoreVertical className="h-4 w-4" />
              </button>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
