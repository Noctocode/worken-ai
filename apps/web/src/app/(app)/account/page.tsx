"use client";

import Link from "next/link";
import {
  Loader2,
  Building2,
  UserRound,
  Cloud,
  Server,
  FileText,
  Key,
  ShieldCheck,
  Check,
  X,
  Download,
} from "lucide-react";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";
import { useQuery } from "@tanstack/react-query";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useAuth } from "@/components/providers";
import { fetchOnboardingProfile, type OnboardingProfile } from "@/lib/api";

const PROVIDER_LABELS: Record<string, string> = {
  openai: "OpenAI",
  azure: "Azure OpenAI",
  anthropic: "Anthropic",
  "private-vpc": "Private VPC",
};

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function getInitials(name: string | null): string {
  if (!name) return "?";
  return name
    .split(" ")
    .map((w) => w[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-1 text-center">
      <span className="text-xs font-medium uppercase tracking-wide text-text-3">
        {label}
      </span>
      <span className="text-base text-text-1">{value ?? "—"}</span>
    </div>
  );
}

function buildPermissions(role: "admin" | "advanced" | "basic") {
  const isAdvanced = role === "admin" || role === "advanced";
  const isAdmin = role === "admin";
  return [
    { label: "View projects and teams you belong to", allowed: true },
    { label: "Create projects", allowed: isAdvanced },
    { label: "Create teams", allowed: isAdvanced },
    { label: "Invite users to a team", allowed: isAdvanced },
    { label: "Remove users from the organization", allowed: isAdmin },
  ];
}

export default function AccountPage() {
  const { user: currentUser } = useAuth();
  const { data, isLoading, error } = useQuery<OnboardingProfile>({
    queryKey: ["onboarding", "profile"],
    queryFn: fetchOnboardingProfile,
  });

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center py-24">
        <Loader2 className="h-8 w-8 animate-spin text-text-3" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="flex h-full items-center justify-center py-24">
        <p className="text-text-3">Failed to load your account.</p>
      </div>
    );
  }

  const ProfileIcon = data.profileType === "company" ? Building2 : UserRound;
  const InfraIcon = data.infraChoice === "on-premise" ? Server : Cloud;

  return (
    <div className="mx-auto flex w-full max-w-[640px] flex-col items-center gap-6 py-6">
      {/* Header card */}
      <Card className="flex w-full flex-col items-center gap-3 p-8 text-center">
        <Avatar className="h-20 w-20 border border-black-400">
          <AvatarImage src={data.picture ?? "/default-avatar.png"} alt={data.name ?? ""} />
          <AvatarFallback className="bg-primary-1 text-base font-medium text-primary-6">
            {getInitials(data.name)}
          </AvatarFallback>
        </Avatar>
        <div className="flex flex-col items-center gap-1">
          <h1 className="text-2xl font-bold text-text-1">
            {data.name ?? data.email}
          </h1>
          <p className="text-sm text-text-3">{data.email}</p>
        </div>
      </Card>

      {/* Tier & permissions */}
      {(() => {
        const role = currentUser?.role ?? "basic";
        const isAdvanced = role === "admin" || role === "advanced";
        const permissions = buildPermissions(role as "admin" | "advanced" | "basic");
        return (
          <Card className="flex w-full flex-col items-center gap-5 p-8 text-center">
            <div className="flex flex-col items-center gap-3">
              <div className="flex h-12 w-12 items-center justify-center rounded bg-bg-1">
                <ShieldCheck className="h-6 w-6 text-primary-7" strokeWidth={2} />
              </div>
              <div className="flex flex-col items-center gap-1">
                <span className="text-xs font-medium uppercase tracking-wide text-text-3">
                  Access tier
                </span>
                <Badge
                  className={`border-transparent uppercase tracking-wide text-[11px] px-2 py-0.5 ${
                    currentUser?.role === "admin"
                      ? "bg-[#FFECE8] text-danger-6"
                      : isAdvanced
                        ? "bg-primary-1 text-primary-7"
                        : "bg-bg-3 text-text-2"
                  }`}
                >
                  {currentUser?.role === "admin" ? "Admin" : isAdvanced ? "Advanced" : "Basic"}
                </Badge>
              </div>
              <p className="max-w-[360px] text-sm text-text-3">
                {isAdvanced
                  ? "You have full access to team and project management."
                  : "You can view projects and teams you belong to. Upgrade to Advanced for full access."}
              </p>
            </div>

            <ul className="flex w-full flex-col gap-2 text-left">
              {permissions.map((p) => (
                <li
                  key={p.label}
                  className="flex items-center gap-3 rounded border border-border-2 bg-bg-white px-4 py-3"
                >
                  <span
                    className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full ${
                      p.allowed ? "bg-[#23C343]/15" : "bg-bg-3"
                    }`}
                  >
                    {p.allowed ? (
                      <Check className="h-3.5 w-3.5 text-[#23C343]" strokeWidth={3} />
                    ) : (
                      <X className="h-3.5 w-3.5 text-text-3" strokeWidth={3} />
                    )}
                  </span>
                  <span
                    className={`text-sm ${
                      p.allowed ? "text-text-1" : "text-text-3 line-through"
                    }`}
                  >
                    {p.label}
                  </span>
                </li>
              ))}
            </ul>
          </Card>
        );
      })()}

      {/* Profile type */}
      <Card className="flex w-full flex-col items-center gap-6 p-8 text-center">
        <div className="flex flex-col items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded bg-bg-1">
            <ProfileIcon className="h-6 w-6 text-primary-7" strokeWidth={2} />
          </div>
          <h2 className="text-lg font-semibold text-text-1">
            {data.profileType === "company"
              ? "Company Profile"
              : data.profileType === "personal"
                ? "Private Professional Profile"
                : "Profile"}
          </h2>
        </div>

        {data.profileType === "company" && (
          <div className="flex w-full flex-col items-center gap-5">
            <Field label="Company name" value={data.companyName} />
            <Field label="Industry" value={data.industry} />
            <Field label="Team size" value={data.teamSize} />
          </div>
        )}
        {data.profileType === "personal" && (
          <Field label="Full name" value={data.name} />
        )}
      </Card>

      {/* Infrastructure */}
      <Card className="flex w-full flex-col items-center gap-3 p-8 text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded bg-bg-1">
          <InfraIcon className="h-6 w-6 text-primary-7" strokeWidth={2} />
        </div>
        <div className="flex flex-col items-center gap-1">
          <span className="text-xs font-medium uppercase tracking-wide text-text-3">
            AI Infrastructure
          </span>
          <span className="text-base font-semibold text-text-1">
            {data.infraChoice === "managed"
              ? "Managed Cloud — Hosted by WorkenAI"
              : data.infraChoice === "on-premise"
                ? "On-Premise / Private Cloud"
                : "Not set"}
          </span>
        </div>
      </Card>

      {/* LLM providers */}
      <Card className="flex w-full flex-col items-center gap-4 p-8 text-center">
        <div className="flex flex-col items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded bg-bg-1">
            <Key className="h-6 w-6 text-primary-7" strokeWidth={2} />
          </div>
          <h2 className="text-lg font-semibold text-text-1">
            Language Model Providers
          </h2>
        </div>
        {data.providers.length === 0 ? (
          <p className="text-sm text-text-3">
            No providers connected. You can add API keys from Settings.
          </p>
        ) : (
          <ul className="flex w-full flex-col items-stretch gap-2">
            {data.providers.map((p) => (
              <li
                key={p.id}
                className="flex items-center justify-between rounded border border-border-2 bg-bg-white px-4 py-3"
              >
                <span className="text-sm font-medium text-text-1">
                  {PROVIDER_LABELS[p.provider] ?? p.provider}
                </span>
                <span className="text-xs text-text-3">•••• connected</span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {/* Knowledge docs */}
      <Card className="flex w-full flex-col items-center gap-4 p-8 text-center">
        <div className="flex flex-col items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded bg-bg-1">
            <FileText className="h-6 w-6 text-primary-7" strokeWidth={2} />
          </div>
          <h2 className="text-lg font-semibold text-text-1">
            Knowledge Documents
          </h2>
        </div>
        {data.documents.length === 0 ? (
          <p className="text-sm text-text-3">No documents uploaded yet.</p>
        ) : (
          <ul className="flex w-full flex-col items-stretch gap-2 text-left">
            {data.documents.map((d) => (
              <li
                key={d.id}
                className="flex items-center justify-between gap-3 rounded border border-border-2 bg-bg-white px-4 py-3"
              >
                <div className="flex min-w-0 flex-col">
                  <span className="truncate text-sm font-medium text-text-1">
                    {d.filename}
                  </span>
                  <span className="text-xs text-text-3">
                    {d.mimeType ?? "unknown"} • {formatBytes(d.sizeBytes)}
                  </span>
                </div>
                {/* Same-origin credential cookies are set on the API host,
                    so a direct anchor to the API carries auth. */}
                <a
                  href={`${API_URL}/onboarding/documents/${d.id}/download`}
                  className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-md px-3 text-xs font-medium text-primary-6 transition-colors hover:bg-primary-1/40"
                  title={`Download ${d.filename}`}
                >
                  <Download className="h-4 w-4" />
                  Download
                </a>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Button asChild variant="outline">
        <Link href="/">Back to dashboard</Link>
      </Button>
    </div>
  );
}
