"use client";

import { use, useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  FileText,
  Folder,
  Loader2,
  MoreVertical,
  Search,
  Trash2,
  Upload,
} from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  fetchKnowledgeFolder,
  uploadKnowledgeFiles,
  deleteKnowledgeFile,
} from "@/lib/api";

const TYPE_STYLES: Record<string, string> = {
  PDF: "bg-[#FFECE8] text-danger-6",
  DOCX: "bg-[#EBF8FF] text-[#0369A1]",
  DOC: "bg-[#EBF8FF] text-[#0369A1]",
  XLSX: "bg-[#E8FFEA] text-[#009A29]",
  XLS: "bg-[#E8FFEA] text-[#009A29]",
  PNG: "bg-[#FFF3E6] text-[#FF7D00]",
  JPG: "bg-[#FFF3E6] text-[#FF7D00]",
  JPEG: "bg-[#FFF3E6] text-[#FF7D00]",
};

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

function formatDate(d: string): string {
  return new Date(d).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatDateTime(d: string): string {
  return new Date(d).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export default function FolderDetailPage({
  params,
}: {
  params: Promise<{ folderId: string }>;
}) {
  const { folderId } = use(params);
  const [query, setQuery] = useState("");

  const queryClient = useQueryClient();

  const { data: folder, isLoading } = useQuery({
    queryKey: ["knowledge-folder", folderId],
    queryFn: () => fetchKnowledgeFolder(folderId),
    enabled: !!folderId,
  });

  const uploadMutation = useMutation({
    mutationFn: (files: File[]) => uploadKnowledgeFiles(folderId, files),
    onSuccess: (uploaded) => {
      queryClient.invalidateQueries({
        queryKey: ["knowledge-folder", folderId],
      });
      queryClient.invalidateQueries({ queryKey: ["knowledge-folders"] });
      queryClient.invalidateQueries({ queryKey: ["knowledge-recent"] });
      toast.success(`Uploaded ${uploaded.length} file(s).`);
    },
    onError: () => toast.error("Failed to upload files."),
  });

  const deleteMutation = useMutation({
    mutationFn: deleteKnowledgeFile,
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["knowledge-folder", folderId],
      });
      queryClient.invalidateQueries({ queryKey: ["knowledge-folders"] });
      queryClient.invalidateQueries({ queryKey: ["knowledge-recent"] });
      toast.success("File deleted.");
    },
    onError: () => toast.error("Failed to delete file."),
  });

  const handleUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    if (files.length > 0) uploadMutation.mutate(files);
    e.target.value = "";
  };

  const handleDelete = (id: string, name: string) => {
    if (!confirm(`Delete "${name}"?`)) return;
    deleteMutation.mutate(id);
  };

  const filtered = useMemo(() => {
    if (!folder) return [];
    const q = query.trim().toLowerCase();
    if (!q) return folder.files;
    return folder.files.filter(
      (f) =>
        f.name.toLowerCase().includes(q) ||
        (f.uploadedByName ?? "").toLowerCase().includes(q) ||
        (f.fileType ?? "").toLowerCase().includes(q),
    );
  }, [query, folder]);

  if (isLoading || !folder) {
    return (
      <div className="flex flex-1 items-center justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-text-3" />
      </div>
    );
  }

  const totalBytes = folder.files.reduce((sum, f) => sum + f.sizeBytes, 0);

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
          <Folder
            className="h-10 w-10 shrink-0 text-primary-6"
            strokeWidth={1.5}
          />
          <div className="flex flex-col">
            <h1 className="text-[20px] font-bold text-text-1">
              {folder.name}
            </h1>
            <div className="flex flex-wrap items-center gap-3 text-[13px] text-text-3">
              <span>{folder.files.length} files</span>
              <span>{formatBytes(totalBytes)} total</span>
              <span>
                Last modified {formatDate(folder.updatedAt)}
              </span>
            </div>
          </div>
        </div>
        <label>
          <input
            type="file"
            multiple
            accept=".pdf,.docx,.xlsx,.doc,.xls,.png,.jpg,.jpeg"
            className="hidden"
            onChange={handleUpload}
          />
          <Button
            asChild
            className="shrink-0 cursor-pointer gap-2 bg-primary-6 hover:bg-primary-7"
          >
            <span>
              <Upload className="h-4 w-4" />
              Upload Files
            </span>
          </Button>
        </label>
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
                  key={f.id}
                  className="border-b border-border-2 last:border-b-0 transition-colors hover:bg-bg-1"
                >
                  <td className="px-5 py-4">
                    <div className="flex items-center gap-3">
                      <FileText
                        className="h-5 w-5 shrink-0 text-text-3"
                        strokeWidth={1.5}
                      />
                      <span className="font-medium text-text-1">{f.name}</span>
                    </div>
                  </td>
                  <td className="px-5 py-4">
                    <span
                      className={`inline-flex rounded px-2 py-0.5 text-[11px] font-semibold ${TYPE_STYLES[f.fileType ?? ""] ?? "bg-bg-1 text-text-2"}`}
                    >
                      {f.fileType ?? "—"}
                    </span>
                  </td>
                  <td className="px-5 py-4 text-text-2">
                    {formatBytes(f.sizeBytes)}
                  </td>
                  <td className="px-5 py-4 text-text-2">
                    {f.uploadedByName ?? "—"}
                  </td>
                  <td className="px-5 py-4 text-text-3">
                    {formatDateTime(f.createdAt)}
                  </td>
                  <td className="px-5 py-4">
                    <button
                      type="button"
                      onClick={() => handleDelete(f.id, f.name)}
                      className="flex h-6 w-6 cursor-pointer items-center justify-center rounded text-text-3 transition-colors hover:bg-[#FFECE8] hover:text-danger-6"
                      title="Delete file"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
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
                    {query
                      ? "No files match your search."
                      : "No files in this folder yet. Upload some above."}
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
              key={f.id}
              className={`flex items-center gap-3 px-4 py-4 ${idx > 0 ? "border-t border-border-2" : ""}`}
            >
              <FileText
                className="h-5 w-5 shrink-0 text-text-3"
                strokeWidth={1.5}
              />
              <div className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-[14px] font-medium text-text-1">
                  {f.name}
                </span>
                <span className="text-[12px] text-text-3">
                  {formatBytes(f.sizeBytes)} •{" "}
                  {f.uploadedByName ?? "Unknown"} •{" "}
                  {formatDateTime(f.createdAt)}
                </span>
              </div>
              <button
                type="button"
                onClick={() => handleDelete(f.id, f.name)}
                className="flex h-6 w-6 shrink-0 cursor-pointer items-center justify-center rounded text-text-3 hover:text-danger-6"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
          {filtered.length === 0 && (
            <p className="py-8 text-center text-[13px] text-text-3">
              {query
                ? "No files match your search."
                : "No files yet."}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
