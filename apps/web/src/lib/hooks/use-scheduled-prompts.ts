"use client";

import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import {
  createScheduledPrompt,
  deleteScheduledPrompt,
  fetchScheduledPrompt,
  fetchScheduledPromptRuns,
  fetchScheduledPrompts,
  runScheduledPromptNow,
  toggleScheduledPrompt,
  updateScheduledPrompt,
  type ScheduledPromptInput,
} from "@/lib/api";

const LIST_KEY = ["ai-cron", "list"] as const;
const STALE_TIME_MS = 30 * 1000; // schedule/next-run can change

export function useScheduledPrompts() {
  const { data, isLoading, error } = useQuery({
    queryKey: LIST_KEY,
    queryFn: fetchScheduledPrompts,
    staleTime: STALE_TIME_MS,
  });
  return { prompts: data ?? [], isLoading, error };
}

export function useScheduledPrompt(id: string | undefined) {
  const { data, isLoading, error } = useQuery({
    queryKey: ["ai-cron", id],
    queryFn: () => fetchScheduledPrompt(id as string),
    enabled: !!id,
    staleTime: STALE_TIME_MS,
  });
  return { prompt: data, isLoading, error };
}

export function useScheduledPromptRuns(id: string | undefined) {
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["ai-cron", id, "runs"],
    queryFn: () => fetchScheduledPromptRuns(id as string),
    enabled: !!id,
    staleTime: 15 * 1000,
  });
  return { runs: data ?? [], isLoading, error, refetch };
}

export function useCreateScheduledPrompt() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: ScheduledPromptInput) => createScheduledPrompt(data),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: LIST_KEY });
    },
  });
}

export function useUpdateScheduledPrompt() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      data,
    }: {
      id: string;
      data: Partial<ScheduledPromptInput>;
    }) => updateScheduledPrompt(id, data),
    onSuccess: (_res, { id }) => {
      void qc.invalidateQueries({ queryKey: LIST_KEY });
      void qc.invalidateQueries({ queryKey: ["ai-cron", id] });
    },
  });
}

export function useDeleteScheduledPrompt() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deleteScheduledPrompt(id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: LIST_KEY });
    },
  });
}

export function useToggleScheduledPrompt() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, isEnabled }: { id: string; isEnabled: boolean }) =>
      toggleScheduledPrompt(id, isEnabled),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: LIST_KEY });
    },
  });
}

export function useRunScheduledPromptNow() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => runScheduledPromptNow(id),
    onSuccess: (_res, id) => {
      void qc.invalidateQueries({ queryKey: ["ai-cron", id, "runs"] });
      void qc.invalidateQueries({ queryKey: LIST_KEY });
    },
  });
}
