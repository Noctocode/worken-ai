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
import Image from "next/image";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import {
  fetchCurrentUserOptional,
  fetchOnboardingDraft,
  updateOnboardingDraft,
  type OnboardingDraft,
} from "@/lib/api";
import { Card } from "@/components/ui/card";

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
  const router = useRouter();
  const [state, setState] = useState<OnboardingScalarState>(emptyState);
  const [files, setFiles] = useState<File[]>([]);
  const hydrated = useRef(false);

  // Inverse of the (app) layout's OnboardingGuard: an already-
  // onboarded user landing on /setup-profile (e.g. by typing the URL,
  // a stale bookmark, or hitting Back from the dashboard) gets bounced
  // home — otherwise they'd hit step 6's Complete Setup and get a 409
  // "Onboarding already completed" because users.onboarding_completed_at
  // is already set.
  //
  // The most common path here is the freshly-registered invitee: the
  // BE inherits the inviter's company info + stamps onboardingCompletedAt
  // on /users/invite, so when register-page.tsx redirects to
  // /setup-profile, this guard fires and bounces them home. We hold
  // the loader on screen briefly with the workspace name so the user
  // knows what's happening instead of seeing a flash of the wizard
  // step-1 picker.
  //
  // Snapshotted ONCE on mount via a ref. Step 6's submit invalidates
  // ["auth","me"], which would flip onboardingCompleted to true mid-
  // flow; if we re-evaluated on every change we'd redirect away from
  // the "Training your AI…" progress screen before it had a chance to
  // poll. Step 6 owns the post-success redirect itself.
  const guardRanRef = useRef(false);
  // Tri-state guard:
  //   "checking" — initial; we don't yet know if this visitor is
  //                onboarded. We render the loader (NOT the wizard
  //                children) so an invitee never sees a flash of the
  //                profile-type picker before the redirect kicks in.
  //   "pass"     — visitor is unauthenticated or hasn't completed
  //                onboarding; render the wizard children.
  //   "joining"  — visitor is already onboarded; render the
  //                "Joining {company}…" copy and redirect home.
  const [guardState, setGuardState] = useState<
    "checking" | "pass" | "joining"
  >("checking");
  const [joiningCompany, setJoiningCompany] = useState<string>("");
  useEffect(() => {
    if (guardRanRef.current) return;
    guardRanRef.current = true;
    let cancelled = false;
    fetchCurrentUserOptional()
      .then((me) => {
        if (cancelled) return;
        if (me?.onboardingCompleted) {
          setJoiningCompany(me.companyName ?? "");
          setGuardState("joining");
          // Brief delay so the user reads the message instead of
          // seeing a sub-100ms flash before the dashboard mounts.
          window.setTimeout(() => {
            if (!cancelled) router.replace("/");
          }, 1200);
        } else {
          setGuardState("pass");
        }
      })
      .catch(() => {
        // Fail open — any /auth/me hiccup shouldn't lock a fresh
        // user out of the wizard. Public-page fetch swallows 401
        // already; this catch handles network errors etc.
        if (!cancelled) setGuardState("pass");
      });
    return () => {
      cancelled = true;
    };
  }, [router]);

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

  // Hold off rendering the wizard until the guard resolves. The
  // "checking" frame renders the same Card chrome as "joining" but
  // without copy — keeps layout stable when we transition to either
  // the joining loader or to the wizard, and avoids flashing the
  // profile-type picker to invitees who are about to be redirected
  // home.
  if (guardState !== "pass") {
    const orgLabel = joiningCompany.trim()
      ? joiningCompany
      : "your organization";
    return (
      <div className="flex min-h-screen w-full items-center justify-center bg-bg-1 bg-[url('/login-bg.png')] bg-cover bg-center bg-no-repeat px-4 py-8">
        <Card className="w-full max-w-[480px] flex flex-col items-center gap-6 p-[40px] bg-bg-white rounded-md text-center">
          <Image
            src="/full-logo.png"
            alt="WorkenAI"
            width={106}
            height={29}
            priority
          />
          <Loader2
            className="h-10 w-10 animate-spin text-primary-7"
            strokeWidth={2}
          />
          {guardState === "joining" ? (
            <div className="flex flex-col gap-2">
              <h1 className="text-[24px] font-bold leading-tight text-text-1">
                Joining {orgLabel}…
              </h1>
              <p className="text-[15px] font-normal leading-snug text-text-2">
                Setting up your access to shared knowledge and tools.
              </p>
            </div>
          ) : null}
        </Card>
      </div>
    );
  }

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
