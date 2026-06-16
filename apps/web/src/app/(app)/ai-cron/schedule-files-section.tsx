"use client";

import { Paperclip, Upload, X } from "lucide-react";
import { useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";

import { useLanguage } from "@/lib/i18n";
import {
  detachScheduleFile,
  fetchScheduleFiles,
  uploadScheduleFiles,
} from "@/lib/api";
import { Button } from "@/components/ui/button";

/**
 * "Files in this context" for a schedule. On edit (scheduleId present) uploads
 * land immediately on the existing schedule. On new (no scheduleId) the chosen
 * File objects are held in `pendingFiles` and uploaded by the form after the
 * schedule is created (approach A).
 */
export function ScheduleFilesSection({
  scheduleId,
  pendingFiles,
  setPendingFiles,
}: {
  scheduleId?: string;
  pendingFiles: File[];
  setPendingFiles: (files: File[]) => void;
}) {
  const { t } = useLanguage();
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  const { data: attached = [], refetch } = useQuery({
    queryKey: ["ai-cron", scheduleId, "files"],
    queryFn: () => fetchScheduleFiles(scheduleId as string),
    enabled: !!scheduleId,
  });

  const onPick = async (list: FileList | null) => {
    const files = list ? Array.from(list) : [];
    if (files.length === 0) return;
    if (scheduleId) {
      setUploading(true);
      try {
        await uploadScheduleFiles(scheduleId, files);
        await refetch();
      } catch {
        toast.error(t("aiCron.files.uploadFailed"));
      } finally {
        setUploading(false);
      }
    } else {
      setPendingFiles([...pendingFiles, ...files]);
    }
    if (inputRef.current) inputRef.current.value = "";
  };

  const removeAttached = async (fileId: string) => {
    if (!scheduleId) return;
    try {
      await detachScheduleFile(scheduleId, fileId);
      await refetch();
    } catch {
      // best-effort
    }
  };

  const rows = scheduleId
    ? attached.map((f) => ({ key: f.fileId, name: f.name }))
    : pendingFiles.map((f, i) => ({ key: `p-${i}`, name: f.name }));

  return (
    <section className="flex flex-col gap-3 rounded-xl border border-border-2 bg-bg-white p-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-text-1">
          {t("aiCron.files.title")}
        </h2>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={uploading}
          onClick={() => inputRef.current?.click()}
        >
          <Upload className="size-4" />
          {uploading ? t("aiCron.files.uploading") : t("aiCron.files.add")}
        </Button>
        <input
          ref={inputRef}
          type="file"
          multiple
          className="hidden"
          accept=".pdf,.doc,.docx,.xls,.xlsx"
          onChange={(e) => void onPick(e.target.files)}
        />
      </div>

      {rows.length === 0 ? (
        <p className="text-xs text-text-3">{t("aiCron.files.empty")}</p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {rows.map((r, i) => (
            <li
              key={r.key}
              className="flex items-center gap-2 rounded-lg bg-bg-2 px-3 py-2 text-sm text-text-1"
            >
              <Paperclip className="size-4 shrink-0 text-text-3" />
              <span className="flex-1 truncate">{r.name}</span>
              <button
                type="button"
                className="text-text-3 hover:text-danger-6"
                onClick={() =>
                  scheduleId
                    ? void removeAttached(attached[i].fileId)
                    : setPendingFiles(pendingFiles.filter((_, j) => j !== i))
                }
              >
                <X className="size-4" />
              </button>
            </li>
          ))}
        </ul>
      )}

      <p className="text-xs text-text-3">{t("aiCron.files.hint")}</p>
    </section>
  );
}
