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
}

const STORAGE_KEY = "workenai:onboarding:v1";
const emptyState: OnboardingScalarState = { apiKeys: {} };

const OnboardingContext = createContext<OnboardingContextValue | null>(null);

export default function SetupProfileLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [state, setState] = useState<OnboardingScalarState>(emptyState);
  const [files, setFiles] = useState<File[]>([]);
  const hydrated = useRef(false);

  // Hydrate from sessionStorage once on mount.
  useEffect(() => {
    if (hydrated.current) return;
    hydrated.current = true;
    try {
      const raw = sessionStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as OnboardingScalarState;
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setState({ ...emptyState, ...parsed, apiKeys: parsed.apiKeys ?? {} });
      }
    } catch {
      // Corrupt storage — ignore and start fresh.
    }
  }, []);

  // Persist scalars on every change.
  useEffect(() => {
    if (!hydrated.current) return;
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(state));
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

  const value = useMemo<OnboardingContextValue>(
    () => ({ state, update, setApiKey, files, setFiles, reset }),
    [state, update, setApiKey, files, reset],
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
