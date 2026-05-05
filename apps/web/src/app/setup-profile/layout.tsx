"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  fetchOnboardingDraft,
  updateOnboardingDraft,
  type OnboardingDraft,
} from "@/lib/api";

type ProfileType = "company" | "personal";
type InfraChoice = "managed" | "on-premise";
type Provider = "openai" | "azure" | "anthropic" | "private-vpc";

// sessionStorage-persisted, JSON-serializable scalars gathered across steps 1-5.
export interface OnboardingScalarState {
  profileType?: ProfileType;
  fullName?: string;
  companyName?: string;
  industry?: string;
  teamSize?: string;
  infraChoice?: InfraChoice;
  apiKeys: Partial<Record<Provider, string>>;
}

interface OnboardingContextValue {
  state: OnboardingScalarState;
  update: (patch: Partial<OnboardingScalarState>) => void;
  setApiKey: (provider: Provider, key: string) => void;
  // Files are kept in memory only — FileList/File can't be persisted across
  // reloads. Refreshing step 6 means re-selecting files.
  files: File[];
  setFiles: (files: File[]) => void;
  reset: () => void;
  /**
   * Fire-and-forget BE persist of the wizard's scalar state. Steps
   * call this after each Continue so the draft survives session
   * loss. Pass the same patch you'd give to `update` so the snapshot
   * sent to the BE includes the just-typed value, not the
   * one-render-stale ref. Calling without a patch persists the
   * current state as-is (useful when individual onChanges already
   * pushed the values into context).
   */
  saveDraft: (patch?: Partial<OnboardingScalarState>) => void;
}

const STORAGE_KEY = "workenai:onboarding:v1";
const emptyState: OnboardingScalarState = { apiKeys: {} };

const OnboardingContext = createContext<OnboardingContextValue | null>(null);

/** Strip apiKeys before sending to either storage layer. */
function persistableScalars(state: OnboardingScalarState): OnboardingDraft {
  const { apiKeys: _apiKeys, ...rest } = state;
  void _apiKeys;
  return rest;
}

export default function SetupProfileLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [state, setState] = useState<OnboardingScalarState>(emptyState);
  const [files, setFiles] = useState<File[]>([]);
  const hydrated = useRef(false);

  // Hydrate on mount: prefer the BE draft (durable across sessions /
  // device switches) and fall back to sessionStorage if the BE has
  // nothing (or 401-ed). sessionStorage stays in play as a fast local
  // cache between Continue clicks within a single session.
  useEffect(() => {
    if (hydrated.current) return;
    hydrated.current = true;

    let cancelled = false;
    const hydrateFromSessionStorage = (): boolean => {
      try {
        const raw = sessionStorage.getItem(STORAGE_KEY);
        if (raw) {
          const parsed = JSON.parse(raw) as Omit<
            OnboardingScalarState,
            "apiKeys"
          >;
          // API keys intentionally never round-trip through storage;
          // always restart them as empty on reload.
          setState({ ...emptyState, ...parsed, apiKeys: {} });
          return true;
        }
      } catch {
        // Corrupt storage — ignore and start fresh.
      }
      return false;
    };

    fetchOnboardingDraft()
      .then((draft) => {
        if (cancelled) return;
        if (draft && Object.keys(draft).length > 0) {
          setState({ ...emptyState, ...draft, apiKeys: {} });
        } else {
          hydrateFromSessionStorage();
        }
      })
      .catch(() => {
        if (cancelled) return;
        hydrateFromSessionStorage();
      });

    return () => {
      cancelled = true;
    };
  }, []);

  // Persist scalars on every change. API keys are held in memory only so
  // a compromised tab (XSS / malicious extension) can't lift secrets out
  // of storage — at worst it reads the current tab's JS heap.
  useEffect(() => {
    if (!hydrated.current) return;
    try {
      sessionStorage.setItem(
        STORAGE_KEY,
        JSON.stringify(persistableScalars(state)),
      );
    } catch {
      // Quota exceeded or disabled — not fatal.
    }
  }, [state]);

  const update = useCallback((patch: Partial<OnboardingScalarState>) => {
    setState((prev) => ({ ...prev, ...patch }));
  }, []);

  const setApiKey = useCallback((provider: Provider, key: string) => {
    setState((prev) => ({
      ...prev,
      apiKeys: { ...prev.apiKeys, [provider]: key },
    }));
  }, []);

  const reset = useCallback(() => {
    setState(emptyState);
    setFiles([]);
    try {
      sessionStorage.removeItem(STORAGE_KEY);
    } catch {
      // ignore
    }
  }, []);

  // Snapshot current state at call time, fire PATCH async. We don't
  // await — Continue should feel instant; if the network is slow the
  // sessionStorage cache + the next Continue's PATCH cover us. A
  // genuine BE failure would surface on the next /onboarding/complete
  // call where it actually matters.
  //
  // The optional `patch` argument matters: when a Continue handler
  // calls `update({ x })` and then `saveDraft({ x })` in the same
  // event, the `state` here is still the pre-update value (setState
  // hasn't flushed). Merging the patch into the snapshot guarantees
  // the BE sees the freshly-typed field.
  const stateRef = useRef(state);
  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  const saveDraft = useCallback(
    (patch?: Partial<OnboardingScalarState>) => {
      const merged = { ...stateRef.current, ...(patch ?? {}) };
      const snapshot = persistableScalars(merged);
      if (Object.keys(snapshot).length === 0) return;
      void updateOnboardingDraft(snapshot).catch(() => {
        // Swallow — sessionStorage is the fallback.
      });
    },
    [],
  );

  const value = useMemo<OnboardingContextValue>(
    () => ({
      state,
      update,
      setApiKey,
      files,
      setFiles,
      reset,
      saveDraft,
    }),
    [state, update, setApiKey, files, reset, saveDraft],
  );

  return (
    <OnboardingContext.Provider value={value}>
      {children}
    </OnboardingContext.Provider>
  );
}

export function useOnboarding() {
  const ctx = useContext(OnboardingContext);
  if (!ctx) {
    throw new Error("useOnboarding must be used inside SetupProfileLayout");
  }
  return ctx;
}
