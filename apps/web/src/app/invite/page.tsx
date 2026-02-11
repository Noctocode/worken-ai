"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  Infinity,
  Loader2,
  CheckCircle2,
  XCircle,
  AlertTriangle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  fetchInviteDetails,
  fetchCurrentUser,
  acceptInvite,
  type InviteDetails,
  type User,
} from "@/lib/api";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";

type PageState =
  | { type: "loading" }
  | { type: "error"; message: string }
  | { type: "invite"; invite: InviteDetails; user: User | null }
  | { type: "accepting" }
  | { type: "accepted" }
  | { type: "already_accepted" };

function InviteContent() {
  const searchParams = useSearchParams();
  const token = searchParams.get("token");
  const [state, setState] = useState<PageState>({ type: "loading" });

  useEffect(() => {
    if (!token) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setState({ type: "error", message: "No invitation token provided." });
      return;
    }

    async function load() {
      let invite: InviteDetails | null = null;
      let user: User | null = null;
      let inviteError: string | null = null;

      // Fetch invite details and auth state in parallel
      const [inviteResult, userResult] = await Promise.allSettled([
        fetchInviteDetails(token!),
        fetchCurrentUser(),
      ]);

      if (inviteResult.status === "fulfilled") {
        invite = inviteResult.value;
      } else {
        inviteError = inviteResult.reason?.message || "Invalid invitation";
      }

      if (userResult.status === "fulfilled") {
        user = userResult.value;
      }

      if (inviteError) {
        // If invite fetch failed but user is logged in, it might be already accepted
        if (user && inviteError.includes("already been accepted")) {
          setState({ type: "already_accepted" });
        } else if (user && inviteError.includes("not found")) {
          // Token consumed by processTeamInvitations during OAuth
          setState({ type: "already_accepted" });
        } else {
          setState({ type: "error", message: inviteError });
        }
        return;
      }

      setState({ type: "invite", invite: invite!, user });
    }

    load();
  }, [token]);

  const handleAccept = useCallback(async () => {
    if (!token) return;
    setState({ type: "accepting" });
    try {
      await acceptInvite(token);
      setState({ type: "accepted" });
      setTimeout(() => {
        window.location.href = "/teams";
      }, 2000);
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : "Failed to accept invitation";
      if (message.includes("already been accepted")) {
        setState({ type: "already_accepted" });
      } else {
        setState({ type: "error", message });
      }
    }
  }, [token]);

  const handleSignIn = useCallback(() => {
    if (!token) return;
    // Set cookie so OAuth callback redirects back here
    document.cookie = `invite_return_to=/invite?token=${token}; path=/; max-age=600; SameSite=Lax`;
    window.location.href = `${API_URL}/auth/google`;
  }, [token]);

  return (
    <div className="flex h-screen w-full items-center justify-center bg-slate-50/50">
      <Card className="w-full max-w-md text-center">
        <CardHeader>
          <div className="flex items-center justify-center gap-2.5 mb-2">
            <div className="flex items-center justify-center text-blue-600">
              <Infinity className="h-10 w-10" />
            </div>
            <span className="text-2xl font-semibold tracking-tight text-slate-900">
              WorkenAI
            </span>
          </div>
        </CardHeader>
        <CardContent>
          {state.type === "loading" && (
            <div className="flex flex-col items-center gap-3 py-8">
              <Loader2 className="h-8 w-8 animate-spin text-slate-400" />
              <p className="text-sm text-slate-500">Loading invitation...</p>
            </div>
          )}

          {state.type === "error" && (
            <div className="flex flex-col items-center gap-4 py-4">
              <XCircle className="h-12 w-12 text-red-400" />
              <div>
                <CardTitle className="text-lg mb-1">
                  Invalid Invitation
                </CardTitle>
                <CardDescription>{state.message}</CardDescription>
              </div>
              <Button
                variant="outline"
                className="mt-2"
                onClick={() => {
                  window.location.href = "/login";
                }}
              >
                Go to Login
              </Button>
            </div>
          )}

          {state.type === "invite" &&
            (() => {
              const { invite, user } = state;
              const emailMatch =
                user && user.email.toLowerCase() === invite.email.toLowerCase();
              const emailMismatch = user && !emailMatch;

              return (
                <div className="flex flex-col items-center gap-4 py-2">
                  <div className="text-left w-full space-y-3">
                    <p className="text-sm text-slate-600">
                      <span className="font-medium text-slate-900">
                        {invite.inviterName}
                      </span>{" "}
                      invited you to join
                    </p>
                    <div className="flex items-center gap-2">
                      <h3 className="text-lg font-semibold text-slate-900">
                        {invite.teamName}
                      </h3>
                      <Badge variant="secondary">{invite.role}</Badge>
                    </div>
                    <p className="text-xs text-slate-400">
                      Invitation sent to {invite.email}
                    </p>
                  </div>

                  {emailMatch && (
                    <Button
                      className="w-full mt-2"
                      size="lg"
                      onClick={handleAccept}
                    >
                      Accept Invitation
                    </Button>
                  )}

                  {emailMismatch && (
                    <div className="w-full space-y-3 mt-2">
                      <div className="flex items-start gap-2 rounded-md bg-amber-50 border border-amber-200 p-3">
                        <AlertTriangle className="h-4 w-4 text-amber-500 mt-0.5 shrink-0" />
                        <p className="text-sm text-amber-700 text-left">
                          You&apos;re signed in as <strong>{user.email}</strong>
                          , but this invitation was sent to{" "}
                          <strong>{invite.email}</strong>.
                        </p>
                      </div>
                      <Button
                        variant="outline"
                        className="w-full"
                        onClick={handleSignIn}
                      >
                        Sign in with a different account
                      </Button>
                    </div>
                  )}

                  {!user && (
                    <Button
                      className="w-full gap-3 mt-2"
                      size="lg"
                      onClick={handleSignIn}
                    >
                      <svg className="h-5 w-5" viewBox="0 0 24 24">
                        <path
                          d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"
                          fill="#4285F4"
                        />
                        <path
                          d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                          fill="#34A853"
                        />
                        <path
                          d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                          fill="#FBBC05"
                        />
                        <path
                          d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                          fill="#EA4335"
                        />
                      </svg>
                      Sign in with Google to Accept
                    </Button>
                  )}
                </div>
              );
            })()}

          {state.type === "accepting" && (
            <div className="flex flex-col items-center gap-3 py-8">
              <Loader2 className="h-8 w-8 animate-spin text-slate-400" />
              <p className="text-sm text-slate-500">Accepting invitation...</p>
            </div>
          )}

          {state.type === "accepted" && (
            <div className="flex flex-col items-center gap-4 py-4">
              <CheckCircle2 className="h-12 w-12 text-green-500" />
              <div>
                <CardTitle className="text-lg mb-1">
                  Invitation Accepted!
                </CardTitle>
                <CardDescription>Redirecting to your teams...</CardDescription>
              </div>
            </div>
          )}

          {state.type === "already_accepted" && (
            <div className="flex flex-col items-center gap-4 py-4">
              <CheckCircle2 className="h-12 w-12 text-green-500" />
              <div>
                <CardTitle className="text-lg mb-1">Already Accepted</CardTitle>
                <CardDescription>
                  This invitation has already been accepted.
                </CardDescription>
              </div>
              <Button
                variant="outline"
                className="mt-2"
                onClick={() => {
                  window.location.href = "/teams";
                }}
              >
                Go to Teams
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export default function InvitePage() {
  return (
    <Suspense
      fallback={
        <div className="flex h-screen w-full items-center justify-center bg-slate-50/50">
          <Loader2 className="h-8 w-8 animate-spin text-slate-400" />
        </div>
      }
    >
      <InviteContent />
    </Suspense>
  );
}
