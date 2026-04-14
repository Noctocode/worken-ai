"use client";

import Link from "next/link";
import { Loader2, Building2, UserRound, Cloud, Server, FileText, Key } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
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

export default function AccountPage() {
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
                className="flex items-center justify-between rounded border border-border-2 bg-bg-white px-4 py-3"
              >
                <div className="flex flex-col">
                  <span className="text-sm font-medium text-text-1">
                    {d.filename}
                  </span>
                  <span className="text-xs text-text-3">
                    {d.mimeType ?? "unknown"} • {formatBytes(d.sizeBytes)}
                  </span>
                </div>
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
