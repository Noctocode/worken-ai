"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import Image from "next/image";
import Link from "next/link";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { apiFetch, fetchInviteDetails, fetchCurrentUserOptional, acceptInvite, type InviteDetails, type User } from "@/lib/api";

type LoadError =
  | { kind: "not_found" }
  | { kind: "expired"; inviterName?: string }
  | { kind: "revoked" }
  | { kind: "already_accepted" }
  | { kind: "missing_token" }
  | { kind: "unknown"; message: string };

type PageState =
  | { kind: "loading" }
  | { kind: "load_error"; error: LoadError }
  | { kind: "ready"; invite: InviteDetails; user: User | null }
  | { kind: "mismatch"; invite: InviteDetails; user: User }
  | { kind: "accepting"; invite: InviteDetails; user: User }
  | { kind: "accept_error"; invite: InviteDetails; user: User; message: string }
  | { kind: "accepted"; invite: InviteDetails };

function classifyLoadError(message: string): LoadError {
  const m = message.toLowerCase();
  if (m.includes("not found")) return { kind: "not_found" };
  if (m.includes("expired")) return { kind: "expired" };
  if (m.includes("revoked")) return { kind: "revoked" };
  if (m.includes("already been accepted")) return { kind: "already_accepted" };
  return { kind: "unknown", message };
}

function classifyAcceptError(message: string): "expired" | "revoked" | "already_accepted" | "mismatch" | "other" {
  const m = message.toLowerCase();
  if (m.includes("expired")) return "expired";
  if (m.includes("revoked")) return "revoked";
  if (m.includes("already been accepted")) return "already_accepted";
  if (m.includes("different email")) return "mismatch";
  return "other";
}

function InviteContent() {
  const searchParams = useSearchParams();
  const token = searchParams.get("token");
  const [state, setState] = useState<PageState>({ kind: "loading" });

  useEffect(() => {
    if (!token) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setState({ kind: "load_error", error: { kind: "missing_token" } });
      return;
    }

    let cancelled = false;

    async function load() {
      const [inviteResult, userResult] = await Promise.allSettled([
        fetchInviteDetails(token!),
        fetchCurrentUserOptional(),
      ]);
      if (cancelled) return;

      const user =
        userResult.status === "fulfilled" ? userResult.value : null;

      if (inviteResult.status === "rejected") {
        const message =
          inviteResult.reason?.message || "Invalid invitation";
        setState({ kind: "load_error", error: classifyLoadError(message) });
        return;
      }

      const invite = inviteResult.value;
      if (
        user &&
        user.email.toLowerCase() !== invite.email.toLowerCase()
      ) {
        setState({ kind: "mismatch", invite, user });
        return;
      }
      setState({ kind: "ready", invite, user });
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [token]);

  const handleAccept = useCallback(async () => {
    if (!token || state.kind !== "ready" || !state.user) return;
    const { invite, user } = state;
    setState({ kind: "accepting", invite, user });
    try {
      await acceptInvite(token);
      setState({ kind: "accepted", invite });
      toast.success(`Welcome to ${invite.teamName}!`);
      setTimeout(() => {
        window.location.href = "/";
      }, 1500);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to accept invitation";
      const cls = classifyAcceptError(message);
      if (cls === "expired") {
        setState({ kind: "load_error", error: { kind: "expired" } });
      } else if (cls === "revoked") {
        setState({ kind: "load_error", error: { kind: "revoked" } });
      } else if (cls === "already_accepted") {
        setState({ kind: "load_error", error: { kind: "already_accepted" } });
      } else if (cls === "mismatch") {
        setState({ kind: "mismatch", invite, user });
      } else {
        setState({
          kind: "accept_error",
          invite,
          user,
          message,
        });
      }
    }
  }, [token, state]);

  const handleSignOutAndRetry = useCallback(async () => {
    try {
      await apiFetch("/auth/logout", { method: "POST" });
    } catch {
      // best-effort; cookies will be cleared by the reload anyway
    }
    window.location.href = token ? `/invite?token=${token}` : "/invite";
  }, [token]);

  // Auto-accept: logged in with matching email → skip the manual click.
  useEffect(() => {
    if (state.kind === "ready" && state.user) {
      handleAccept();
    }
  }, [state, handleAccept]);

  return (
    <div className="flex min-h-screen w-full items-center justify-center bg-bg-1 bg-[url('/login-bg.png')] bg-cover bg-center bg-no-repeat px-4 py-8">
      <Card className="w-full max-w-[500px] flex flex-col items-center gap-8 p-[30px] bg-bg-white border-border-3 rounded-md text-center">
        <Image
          src="/full-logo.png"
          alt="WorkenAI"
          width={106}
          height={29}
          priority
        />

        {state.kind === "loading" && (
          <div className="flex flex-col items-center gap-3 py-4 self-stretch">
            <Loader2 className="h-8 w-8 animate-spin text-text-3" />
            <p className="text-base text-text-2">Loading invitation…</p>
          </div>
        )}

        {state.kind === "load_error" && (
          <ErrorPanel error={state.error} />
        )}

        {state.kind === "ready" && (
          <ReadyPanel
            invite={state.invite}
            user={state.user}
            token={token ?? ""}
            onAccept={handleAccept}
          />
        )}

        {state.kind === "mismatch" && (
          <MismatchPanel
            invite={state.invite}
            user={state.user}
            onSignOut={handleSignOutAndRetry}
          />
        )}

        {state.kind === "accepting" && (
          <AcceptingPanel invite={state.invite} />
        )}

        {state.kind === "accept_error" && (
          <AcceptErrorPanel
            message={state.message}
            onRetry={handleAccept}
          />
        )}

        {state.kind === "accepted" && (
          <AcceptedPanel invite={state.invite} />
        )}
      </Card>
    </div>
  );
}

function HeaderText({
  title,
  subtitle,
}: {
  title: string;
  subtitle?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2 self-stretch">
      <h4 className="text-text-1">{title}</h4>
      {subtitle && (
        <p className="text-[18px] leading-snug font-normal text-text-2">
          {subtitle}
        </p>
      )}
    </div>
  );
}

function ReadyPanel({
  invite,
  user,
  token,
  onAccept,
}: {
  invite: InviteDetails;
  user: User | null;
  token: string;
  onAccept: () => void;
}) {
  const greetingName = user?.name?.split(" ")[0]?.trim() || "there";
  const setPasswordHref = `/invite/set-password?token=${encodeURIComponent(token)}`;
  const loginHref = `/login?token=${encodeURIComponent(token)}&email=${encodeURIComponent(invite.email)}`;
  return (
    <>
      <HeaderText
        title={`Hi ${greetingName}!`}
        subtitle={
          <>
            You were invited to workspace{" "}
            <span className="font-semibold text-text-1">
              “{invite.teamName}”
            </span>{" "}
            by{" "}
            <span className="font-semibold text-text-1">
              {invite.inviterName ?? "a teammate"}
            </span>
            .
          </>
        }
      />
      {user ? (
        <Button
          onClick={onAccept}
          className="w-full h-[52px] px-6 bg-primary-6 hover:bg-primary-7 text-text-white text-base font-normal rounded-lg"
        >
          Accept Invitation
        </Button>
      ) : (
        <div className="self-stretch flex flex-col items-center gap-3">
          <Button
            asChild
            className="w-full h-[52px] px-6 bg-primary-6 hover:bg-primary-7 text-text-white text-base font-normal rounded-lg"
          >
            <Link href={setPasswordHref}>Accept Invitation</Link>
          </Button>
          <p className="text-sm text-text-2">
            {"Already have an account? "}
            <Link
              href={loginHref}
              className="text-primary-6 hover:text-primary-7 font-medium"
            >
              Log in
            </Link>
          </p>
        </div>
      )}
    </>
  );
}

function MismatchPanel({
  invite,
  user,
  onSignOut,
}: {
  invite: InviteDetails;
  user: User;
  onSignOut: () => void;
}) {
  return (
    <>
      <HeaderText
        title="Wrong account"
        subtitle={
          <>
            This invitation was sent to{" "}
            <span className="font-semibold text-text-1">{invite.email}</span>,
            but you’re signed in as{" "}
            <span className="font-semibold text-text-1">{user.email}</span>.
            Please sign out and try again.
          </>
        }
      />
      <Button
        onClick={onSignOut}
        className="w-full h-[52px] px-6 bg-primary-6 hover:bg-primary-7 text-text-white text-base font-normal rounded-lg"
      >
        Sign out
      </Button>
    </>
  );
}

function AcceptingPanel({ invite }: { invite: InviteDetails }) {
  return (
    <>
      <HeaderText
        title="Joining…"
        subtitle={
          <>
            Accepting your invitation to{" "}
            <span className="font-semibold text-text-1">
              “{invite.teamName}”
            </span>
            .
          </>
        }
      />
      <Button
        disabled
        className="w-full h-[52px] px-6 bg-primary-6 text-text-white text-base font-normal rounded-lg gap-2"
      >
        <Loader2 className="h-4 w-4 animate-spin" />
        Accepting…
      </Button>
    </>
  );
}

function AcceptedPanel({ invite }: { invite: InviteDetails }) {
  return (
    <>
      <HeaderText
        title={`Welcome to ${invite.teamName}!`}
        subtitle="Redirecting you to your workspace…"
      />
      <Loader2 className="h-6 w-6 animate-spin text-text-3" />
    </>
  );
}

function AcceptErrorPanel({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  return (
    <>
      <HeaderText
        title="Something went wrong"
        subtitle="We couldn’t accept the invitation. Please try again."
      />
      <div className="self-stretch space-y-3">
        <p className="rounded-md border border-danger-5 bg-bg-1 px-3 py-2 text-sm text-danger-6 text-left">
          {message}
        </p>
        <Button
          onClick={onRetry}
          className="w-full h-[52px] px-6 bg-primary-6 hover:bg-primary-7 text-text-white text-base font-normal rounded-lg"
        >
          Try again
        </Button>
      </div>
    </>
  );
}

function ErrorPanel({ error }: { error: LoadError }) {
  let title: string;
  let subtitle: React.ReactNode;
  let primary: { label: string; href: string } | null = null;
  let secondary: { label: string; href: string } | null = null;

  switch (error.kind) {
    case "missing_token":
      title = "Invitation not found";
      subtitle = "The link is missing a token. Please use the link from your invitation email.";
      secondary = { label: "Back to login", href: "/login" };
      break;
    case "not_found":
      title = "Invitation not found";
      subtitle = "The link may be incorrect or incomplete.";
      secondary = { label: "Back to login", href: "/login" };
      break;
    case "expired":
      title = "This invitation has expired";
      subtitle = "Please ask the person who invited you to send a new invitation.";
      secondary = { label: "Back to login", href: "/login" };
      break;
    case "revoked":
      title = "This invitation is no longer valid";
      subtitle = "The invitation was revoked by the company admin.";
      secondary = { label: "Back to login", href: "/login" };
      break;
    case "already_accepted":
      title = "This invitation has already been accepted";
      subtitle = "You can sign in to your account.";
      primary = { label: "Go to login", href: "/login" };
      break;
    case "unknown":
      title = "Invalid invitation";
      subtitle = error.message;
      secondary = { label: "Back to login", href: "/login" };
      break;
  }

  return (
    <>
      <HeaderText title={title} subtitle={subtitle} />
      <div className="self-stretch flex flex-col gap-2">
        {primary && (
          <Button
            onClick={() => {
              window.location.href = primary!.href;
            }}
            className="w-full h-[52px] px-6 bg-primary-6 hover:bg-primary-7 text-text-white text-base font-normal rounded-lg"
          >
            {primary.label}
          </Button>
        )}
        {secondary && (
          <Button
            variant="outline"
            onClick={() => {
              window.location.href = secondary!.href;
            }}
            className="w-full h-[52px] px-6 border-border-3 text-text-1 text-base font-normal rounded-lg"
          >
            {secondary.label}
          </Button>
        )}
      </div>
    </>
  );
}

export default function InvitePage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen w-full items-center justify-center bg-bg-1">
          <Loader2 className="h-8 w-8 animate-spin text-text-3" />
        </div>
      }
    >
      <InviteContent />
    </Suspense>
  );
}
