"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  FileText,
  Folder,
  FolderInput,
  Loader2,
  MoreVertical,
  Plus,
  Download,
  Search,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  fetchKnowledgeFolders,
  fetchRecentKnowledgeFiles,
  createKnowledgeFolder,
  deleteKnowledgeFolder,
  uploadKnowledgeFiles,
  moveKnowledgeFile,
  deleteKnowledgeFile,
  type KnowledgeFolder,
  type KnowledgeRecentFile,
} from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
  const [deleteFolderId, setDeleteFolderId] = useState<string | null>(null);

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
    refetchOnMount: "always",
  });

  const deleteFolderName =
    folders.find((f) => f.id === deleteFolderId)?.name ?? "";

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

  const [moveFileId, setMoveFileId] = useState<string | null>(null);
  const [moveTargetId, setMoveTargetId] = useState<string>("");
  const moveFileName =
    recentFiles.find((f) => f.id === moveFileId)?.name ?? "";

  const moveMutation = useMutation({
    mutationFn: () => moveKnowledgeFile(moveFileId!, moveTargetId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["knowledge-folders"] });
      queryClient.invalidateQueries({ queryKey: ["knowledge-recent"] });
      setMoveFileId(null);
      setMoveTargetId("");
      toast.success("File moved.");
    },
    onError: () => toast.error("Failed to move file."),
  });

  const deleteFileMutation = useMutation({
    mutationFn: deleteKnowledgeFile,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["knowledge-folders"] });
      queryClient.invalidateQueries({ queryKey: ["knowledge-recent"] });
      toast.success("File deleted.");
    },
    onError: () => toast.error("Failed to delete file."),
  });

  const [deleteFileId, setDeleteFileId] = useState<string | null>(null);
  const deleteFileName =
    recentFiles.find((f) => f.id === deleteFileId)?.name ?? "";

  const handleDeleteFolder = (id: string) => {
    setDeleteFolderId(id);
  };

  const confirmDeleteFolder = () => {
    if (!deleteFolderId) return;
    deleteMutation.mutate(deleteFolderId);
    setDeleteFolderId(null);
  };

  const getAllFilesFolderId = async (): Promise<string> => {
    const existing = folders.find((f) => f.name === "All Files");
    if (existing) return existing.id;
    const created = await createKnowledgeFolder("All Files");
    await queryClient.refetchQueries({ queryKey: ["knowledge-folders"] });
    return created.id;
  };

  const [stagedFiles, setStagedFiles] = useState<File[]>([]);
  const [uploading, setUploading] = useState(false);

  const confirmUpload = async () => {
    if (stagedFiles.length === 0) return;
    setUploading(true);
    try {
      const folderId = await getAllFilesFolderId();
      await uploadKnowledgeFiles(folderId, stagedFiles);
      await Promise.all([
        queryClient.refetchQueries({ queryKey: ["knowledge-folders"] }),
        queryClient.refetchQueries({ queryKey: ["knowledge-recent"] }),
        queryClient.refetchQueries({ queryKey: ["knowledge-folder", folderId] }),
      ]);
      toast.success(`Uploaded ${stagedFiles.length} file(s) to All Files.`);
      setStagedFiles([]);
    } catch {
      toast.error("Failed to upload files.");
    } finally {
      setUploading(false);
    }
  };

  const removeStagedFile = (idx: number) =>
    setStagedFiles((prev) => prev.filter((_, i) => i !== idx));

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const files = Array.from(e.dataTransfer.files);
    if (files.length > 0) setStagedFiles(files);
  };

  const handleBrowse = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    if (files.length > 0) setStagedFiles(files);
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

  if (foldersLoading || filesLoading) {
    return (
      <div className="flex flex-1 items-center justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-text-3" />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6 py-6">
      {/* Mobile search (appbar search is hidden on small screens) */}
      <div className="relative sm:hidden">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-3" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search folders and files..."
          className="h-10 pl-9 placeholder:text-text-3"
        />
      </div>

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

      {/* Folders */}
      <section>
        <div className="flex items-center justify-between">
          <h2 className="text-[18px] font-bold text-text-1">Folders</h2>
          <Button
            onClick={() => setNewFolderOpen(true)}
            variant="outline"
            className="cursor-pointer gap-2 text-[13px] dark:border-primary-6 dark:bg-primary-6 dark:text-primary-foreground dark:hover:bg-primary-7 dark:hover:border-primary-7"
          >
            <Plus className="h-3.5 w-3.5" />
            New Folder
          </Button>
        </div>
        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {filteredFolders.map((folder) => (
            <Link
              key={folder.id}
              href={`/knowledge-core/${folder.id}`}
              className="flex flex-col gap-3 rounded border border-border-2 bg-bg-white p-6 transition-colors hover:bg-primary-1"
            >
              <div className="flex items-start justify-between">
                <Folder
                  className="h-8 w-8 text-primary-6"
                  strokeWidth={1.5}
                />
                <div
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                  }}
                >
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button
                        type="button"
                        className="flex h-6 w-6 cursor-pointer items-center justify-center rounded text-text-3 hover:bg-bg-1 hover:text-text-1"
                      >
                        <MoreVertical className="h-4 w-4" />
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem
                        onSelect={() => handleDeleteFolder(folder.id)}
                        className="text-danger-6 focus:text-danger-6"
                      >
                        <Trash2 className="mr-2 h-3.5 w-3.5" />
                        Delete
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
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
      <section className="flex flex-col gap-6">
        <h2 className="text-[18px] font-bold text-text-1">Recent Files</h2>
        <div className="flex flex-col gap-3">
          {filteredFiles.map((file) => (
            <div
              key={file.id}
              className="flex items-center gap-4 rounded border border-border-2 bg-bg-white px-4 py-3 transition-colors hover:bg-primary-1"
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
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    className="flex h-6 w-6 shrink-0 cursor-pointer items-center justify-center rounded text-text-3 hover:bg-bg-1 hover:text-text-1"
                  >
                    <MoreVertical className="h-4 w-4" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem asChild>
                    <a
                      href={`${process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001"}/knowledge-core/files/${file.id}/download`}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      <Download className="mr-2 h-3.5 w-3.5" />
                      Download
                    </a>
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onSelect={() => {
                      setMoveFileId(file.id);
                      setMoveTargetId("");
                    }}
                  >
                    <FolderInput className="mr-2 h-3.5 w-3.5" />
                    Move to...
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    onSelect={() => setDeleteFileId(file.id)}
                    className="text-danger-6 focus:text-danger-6"
                  >
                    <Trash2 className="mr-2 h-3.5 w-3.5" />
                    Delete
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
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

      {/* Delete Folder Dialog */}
      <Dialog
        open={deleteFolderId !== null}
        onOpenChange={(open) => !open && setDeleteFolderId(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Folder</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete{" "}
              <strong>{deleteFolderName}</strong> and all its files? This
              action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              onClick={() => setDeleteFolderId(null)}
              className="cursor-pointer"
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={confirmDeleteFolder}
              disabled={deleteMutation.isPending}
              className="cursor-pointer"
            >
              {deleteMutation.isPending ? "Deleting..." : "Delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Move File Dialog */}
      <Dialog
        open={moveFileId !== null}
        onOpenChange={(open) => !open && setMoveFileId(null)}
      >
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Move File</DialogTitle>
          </DialogHeader>
          <p className="text-[13px] text-text-2">
            Move <strong>{moveFileName}</strong> to:
          </p>
          <Select value={moveTargetId} onValueChange={setMoveTargetId}>
            <SelectTrigger className="w-full cursor-pointer data-[size=default]:h-10">
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
          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              onClick={() => setMoveFileId(null)}
              className="cursor-pointer"
            >
              Cancel
            </Button>
            <Button
              onClick={() => moveMutation.mutate()}
              disabled={!moveTargetId || moveMutation.isPending}
              className="cursor-pointer bg-primary-6 hover:bg-primary-7"
            >
              {moveMutation.isPending ? "Moving..." : "Move"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Upload Confirmation Dialog */}
      <Dialog
        open={stagedFiles.length > 0}
        onOpenChange={(open) => !open && !uploading && setStagedFiles([])}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              Upload {stagedFiles.length} file{stagedFiles.length !== 1 ? "s" : ""}
            </DialogTitle>
            <DialogDescription>
              These files will be uploaded to the <strong>All Files</strong> folder.
            </DialogDescription>
          </DialogHeader>
          <div className="flex max-h-[300px] flex-col gap-2 overflow-y-auto">
            {stagedFiles.map((f, i) => (
              <div
                key={i}
                className="flex items-center gap-3 rounded border border-border-2 bg-bg-1 px-3 py-2"
              >
                <FileText className="h-4 w-4 shrink-0 text-text-3" />
                <div className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-[13px] font-medium text-text-1">
                    {f.name}
                  </span>
                  <span className="text-[11px] text-text-3">
                    {formatBytes(f.size)}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => removeStagedFile(i)}
                  disabled={uploading}
                  className="flex h-5 w-5 shrink-0 cursor-pointer items-center justify-center rounded text-text-3 hover:text-text-1 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>
          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              onClick={() => setStagedFiles([])}
              disabled={uploading}
              className="cursor-pointer"
            >
              Cancel
            </Button>
            <Button
              onClick={confirmUpload}
              disabled={uploading || stagedFiles.length === 0}
              className="cursor-pointer bg-primary-6 hover:bg-primary-7"
            >
              {uploading ? "Uploading..." : "Upload"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete File Dialog */}
      <Dialog
        open={deleteFileId !== null}
        onOpenChange={(open) => !open && setDeleteFileId(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete File</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete{" "}
              <strong>{deleteFileName}</strong>? This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              onClick={() => setDeleteFileId(null)}
              className="cursor-pointer"
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                if (deleteFileId) {
                  deleteFileMutation.mutate(deleteFileId);
                  setDeleteFileId(null);
                }
              }}
              disabled={deleteFileMutation.isPending}
              className="cursor-pointer"
            >
              {deleteFileMutation.isPending ? "Deleting..." : "Delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
