"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  FileText,
  Folder,
  Loader2,
  MoreVertical,
  Plus,
  Upload,
} from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  fetchKnowledgeFolders,
  fetchRecentKnowledgeFiles,
  createKnowledgeFolder,
  deleteKnowledgeFolder,
  uploadKnowledgeFiles,
  type KnowledgeFolder,
  type KnowledgeRecentFile,
} from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

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

export default function KnowledgeCorePage() {
  const [query, setQuery] = useState("");
  const [newFolderOpen, setNewFolderOpen] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [uploadTargetId, setUploadTargetId] = useState<string>("");

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

  const queryClient = useQueryClient();

  const { data: folders = [], isLoading: foldersLoading } = useQuery({
    queryKey: ["knowledge-folders"],
    queryFn: fetchKnowledgeFolders,
  });

  const { data: recentFiles = [], isLoading: filesLoading } = useQuery({
    queryKey: ["knowledge-recent"],
    queryFn: fetchRecentKnowledgeFiles,
  });

  const createMutation = useMutation({
    mutationFn: createKnowledgeFolder,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["knowledge-folders"] });
      setNewFolderOpen(false);
      setNewFolderName("");
      toast.success("Folder created.");
    },
    onError: () => toast.error("Failed to create folder."),
  });

  const deleteMutation = useMutation({
    mutationFn: deleteKnowledgeFolder,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["knowledge-folders"] });
      queryClient.invalidateQueries({ queryKey: ["knowledge-recent"] });
      toast.success("Folder deleted.");
    },
    onError: () => toast.error("Failed to delete folder."),
  });

  const handleDeleteFolder = (id: string, name: string) => {
    if (!confirm(`Delete "${name}" and all its files? This cannot be undone.`))
      return;
    deleteMutation.mutate(id);
  };

  const uploadToFolder = async (files: File[]) => {
    if (files.length === 0) return;
    if (!uploadTargetId) {
      toast.error("Select a destination folder before uploading.");
      return;
    }
    try {
      await uploadKnowledgeFiles(uploadTargetId, files);
      queryClient.invalidateQueries({ queryKey: ["knowledge-folders"] });
      queryClient.invalidateQueries({ queryKey: ["knowledge-recent"] });
      queryClient.invalidateQueries({ queryKey: ["knowledge-folder", uploadTargetId] });
      toast.success(`Uploaded ${files.length} file(s).`);
    } catch {
      toast.error("Failed to upload files.");
    }
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    await uploadToFolder(Array.from(e.dataTransfer.files));
  };

  const handleBrowse = async (e: React.ChangeEvent<HTMLInputElement>) => {
    await uploadToFolder(Array.from(e.target.files ?? []));
    e.target.value = "";
  };

  const filteredFolders = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return folders;
    return folders.filter((f) => f.name.toLowerCase().includes(q));
  }, [query, folders]);

  const filteredFiles = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return recentFiles;
    return recentFiles.filter(
      (f) =>
        f.name.toLowerCase().includes(q) ||
        f.folderName.toLowerCase().includes(q) ||
        (f.uploadedByName ?? "").toLowerCase().includes(q),
    );
  }, [query, recentFiles]);

  if (foldersLoading && filesLoading) {
    return (
      <div className="flex flex-1 items-center justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-text-3" />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6 py-6">
      {/* Upload dropzone */}
      <div
        onDragOver={(e) => e.preventDefault()}
        onDrop={handleDrop}
        className="flex flex-col items-center gap-4 rounded-lg border-2 border-dashed border-border-2 bg-bg-white px-12 py-12"
      >
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
        <div className="flex items-center gap-3">
          <Select value={uploadTargetId} onValueChange={setUploadTargetId}>
            <SelectTrigger className="w-[200px] cursor-pointer data-[size=default]:h-10">
              <SelectValue placeholder="Select folder" />
            </SelectTrigger>
            <SelectContent>
              {folders.map((f) => (
                <SelectItem key={f.id} value={f.id}>
                  {f.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <label>
            <input
              type="file"
              multiple
              accept=".pdf,.docx,.xlsx,.doc,.xls,.png,.jpg,.jpeg"
              className="hidden"
              onChange={handleBrowse}
            />
            <span className="inline-flex cursor-pointer items-center rounded border border-border-2 px-4 py-2 text-[13px] font-medium text-text-1 transition-colors hover:bg-bg-1">
              Browse Files
            </span>
          </label>
        </div>
      </div>

      {/* Folders */}
      <section className="flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <h2 className="text-[18px] font-bold text-text-1">Folders</h2>
          <Button
            onClick={() => setNewFolderOpen(true)}
            variant="outline"
            className="cursor-pointer gap-2 text-[13px]"
          >
            <Plus className="h-3.5 w-3.5" />
            New Folder
          </Button>
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {filteredFolders.map((folder) => (
            <Link
              key={folder.id}
              href={`/knowledge-core/${folder.id}`}
              className="flex flex-col gap-3 rounded border border-border-2 bg-bg-white p-6 transition-colors hover:bg-[#EBF8FF]"
            >
              <div className="flex items-start justify-between">
                <Folder
                  className="h-8 w-8 text-primary-6"
                  strokeWidth={1.5}
                />
                <button
                  type="button"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    handleDeleteFolder(folder.id, folder.name);
                  }}
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
                  {folder.fileCount} files • {formatBytes(folder.totalBytes)}
                </span>
                <span>Modified {formatDate(folder.updatedAt)}</span>
              </div>
            </Link>
          ))}
          {filteredFolders.length === 0 && !foldersLoading && (
            <p className="col-span-full py-8 text-center text-[13px] text-text-3">
              {query ? "No folders match your search." : "No folders yet. Create one to get started."}
            </p>
          )}
        </div>
      </section>

      {/* Recent Files */}
      <section className="flex flex-col gap-4">
        <h2 className="text-[18px] font-bold text-text-1">Recent Files</h2>
        <div className="flex flex-col gap-3">
          {filteredFiles.map((file) => (
            <div
              key={file.id}
              className="flex cursor-pointer items-center gap-4 rounded border border-border-2 bg-bg-white px-4 py-3 transition-colors hover:bg-[#EBF8FF]"
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
                  {file.folderName} • {formatBytes(file.sizeBytes)} •
                  Uploaded by {file.uploadedByName ?? "Unknown"}
                </span>
              </div>
              <span className="hidden shrink-0 text-[13px] text-text-3 sm:block">
                {formatDateTime(file.createdAt)}
              </span>
            </div>
          ))}
          {filteredFiles.length === 0 && !filesLoading && (
            <p className="py-8 text-center text-[13px] text-text-3">
              {query ? "No files match your search." : "No files uploaded yet."}
            </p>
          )}
        </div>
      </section>

      {/* New Folder Dialog */}
      <Dialog open={newFolderOpen} onOpenChange={setNewFolderOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>New Folder</DialogTitle>
          </DialogHeader>
          <Input
            value={newFolderName}
            onChange={(e) => setNewFolderName(e.target.value)}
            placeholder="Folder name"
            className="h-10"
            onKeyDown={(e) => {
              if (e.key === "Enter" && newFolderName.trim()) {
                createMutation.mutate(newFolderName);
              }
            }}
          />
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setNewFolderOpen(false)}
              className="cursor-pointer"
            >
              Cancel
            </Button>
            <Button
              onClick={() => createMutation.mutate(newFolderName)}
              disabled={!newFolderName.trim() || createMutation.isPending}
              className="cursor-pointer bg-primary-6 hover:bg-primary-7"
            >
              {createMutation.isPending ? "Creating..." : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
