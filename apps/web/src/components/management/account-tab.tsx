"use client";

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
  Sparkles,
} from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/components/providers";
import { fetchOnboardingProfile, type OnboardingProfile } from "@/lib/api";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";

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
    <div className="flex flex-col gap-0.5">
      <span className="text-[11px] font-medium uppercase tracking-wide text-text-3">
        {label}
      </span>
      <span className="text-[14px] text-text-1">{value ?? "—"}</span>
    </div>
  );
}

function Section({
  title,
  icon: Icon,
  children,
}: {
  title: string;
  icon: React.ElementType;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-bg-1 bg-bg-white p-5">
      <div className="mb-4 flex items-center gap-2.5">
        <div className="flex h-8 w-8 items-center justify-center rounded bg-bg-1">
          <Icon className="h-4 w-4 text-primary-7" strokeWidth={2} />
        </div>
        <h3 className="text-[14px] font-semibold text-text-1">{title}</h3>
      </div>
      {children}
    </div>
  );
}

/**
 * Static plan catalog. The BE column is loose-typed (any string) so
 * unknown plan ids fall back to a capitalize-the-raw-string render
 * rather than crashing — anyone can ship a new plan id without an
 * FE deploy. Add an entry here when the new plan launches and the
 * marketing copy is final.
 */
const PLAN_DETAILS: Record<
  string,
  { label: string; tagline: string; tone: "neutral" | "primary" | "premium" }
> = {
  free: {
    label: "Free",
    tagline: "You're on the Free plan.",
    tone: "neutral",
  },
};

function getPlanDetails(plan: string) {
  if (PLAN_DETAILS[plan]) return PLAN_DETAILS[plan];
  return {
    label: plan
      .split(/[-_\s]+/)
      .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : ""))
      .join(" "),
    tagline: "Custom plan.",
    tone: "neutral" as const,
  };
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

export function AccountTab() {
  const { user: currentUser } = useAuth();
  const { data, isLoading, error } = useQuery<OnboardingProfile>({
    queryKey: ["onboarding", "profile"],
    queryFn: fetchOnboardingProfile,
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="h-8 w-8 animate-spin text-text-3" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="py-24 text-center text-sm text-text-3">
        Failed to load your account.
      </div>
    );
  }

  const ProfileIcon = data.profileType === "company" ? Building2 : UserRound;
  const InfraIcon = data.infraChoice === "on-premise" ? Server : Cloud;
  const role = currentUser?.role ?? "basic";
  const isAdvanced = role === "admin" || role === "advanced";
  const permissions = buildPermissions(role as "admin" | "advanced" | "basic");

  return (
    <div className="py-5">
      {/* Section header — matches Teams / Users / Models pattern */}
      <div className="mb-5">
        <span className="text-[18px] font-bold text-black-900">
          My Account
        </span>
      </div>

      <div className="flex flex-col gap-4">
        {/* Header row: avatar + name + email on the left, tier badge on right */}
        <div className="flex items-center justify-between gap-4 rounded-lg border border-bg-1 bg-bg-white p-5">
          <div className="flex items-center gap-4 min-w-0">
            <Avatar className="h-14 w-14 shrink-0 border border-black-400">
              <AvatarImage
                src={data.picture ?? "/default-avatar.png"}
                alt={data.name ?? ""}
              />
              <AvatarFallback className="bg-primary-1 text-base font-medium text-primary-6">
                {getInitials(data.name)}
              </AvatarFallback>
            </Avatar>
            <div className="flex min-w-0 flex-col">
              <span className="truncate text-[18px] font-semibold text-text-1">
                {data.name ?? data.email}
              </span>
              <span className="truncate text-[13px] text-text-3">
                {data.email}
              </span>
            </div>
          </div>
          <Badge
            className={`shrink-0 border-transparent uppercase tracking-wide text-[11px] px-2 py-0.5 ${
              role === "admin"
                ? "bg-danger-1 text-danger-6"
                : isAdvanced
                  ? "bg-primary-1 text-primary-7"
                  : "bg-bg-3 text-text-2"
            }`}
          >
            {role === "admin" ? "Admin" : isAdvanced ? "Advanced" : "Basic"}
          </Badge>
        </div>

        {/* 2-column row on lg+: Profile + Infrastructure */}
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Section
            title={
              data.profileType === "company"
                ? "Company Profile"
                : data.profileType === "personal"
                  ? "Private Professional Profile"
                  : "Profile"
            }
            icon={ProfileIcon}
          >
            {data.profileType === "company" && (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <Field label="Company name" value={data.companyName} />
                <Field label="Industry" value={data.industry} />
                <Field label="Team size" value={data.teamSize} />
              </div>
            )}
            {data.profileType === "personal" && (
              <Field label="Full name" value={data.name} />
            )}
            {!data.profileType && (
              <p className="text-[13px] text-text-3">
                Profile type not set yet.
              </p>
            )}
          </Section>

          <Section title="AI Infrastructure" icon={InfraIcon}>
            <p className="text-[14px] text-text-1">
              {data.infraChoice === "managed"
                ? "Managed Cloud — Hosted by WorkenAI"
                : data.infraChoice === "on-premise"
                  ? "On-Premise / Private Cloud"
                  : "Not set"}
            </p>
          </Section>
        </div>

        {/* Plan — full width row showing the user's subscription tier
            plus an Upgrade CTA. The button currently fires a "Coming
            soon" toast — paid plans aren't built yet. Wire it up to a
            real upgrade flow once billing lands. */}
        <Section title="Plan" icon={Sparkles}>
          {(() => {
            const planDetails = getPlanDetails(data.plan);
            const badgeClass =
              planDetails.tone === "premium"
                ? "bg-warning-1 text-warning-7"
                : planDetails.tone === "primary"
                  ? "bg-primary-1 text-primary-7"
                  : "bg-bg-3 text-text-2";
            return (
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  <span
                    className={`inline-flex shrink-0 items-center rounded-full px-3 py-1 text-[13px] font-semibold uppercase tracking-wide ${badgeClass}`}
                  >
                    {planDetails.label}
                  </span>
                  <p className="text-[13px] text-text-3">
                    {planDetails.tagline}
                  </p>
                </div>
                <Button
                  variant="outline"
                  className="shrink-0"
                  onClick={() =>
                    toast.info(
                      "Upgrade flow is coming soon — paid plans aren't live yet.",
                    )
                  }
                >
                  Upgrade account
                </Button>
              </div>
            );
          })()}
        </Section>

        {/* Permissions — full width list */}
        <Section title="Access tier & permissions" icon={ShieldCheck}>
          <p className="mb-3 text-[13px] text-text-3">
            {isAdvanced
              ? "You have full access to team and project management."
              : "You can view projects and teams you belong to. Upgrade to Advanced for full access."}
          </p>
          <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {permissions.map((p) => (
              <li
                key={p.label}
                className="flex items-center gap-2.5 rounded border border-bg-1 bg-bg-1/40 px-3 py-2"
              >
                <span
                  className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full ${
                    p.allowed ? "bg-success-7/15" : "bg-bg-3"
                  }`}
                >
                  {p.allowed ? (
                    <Check
                      className="h-3.5 w-3.5 text-success-7"
                      strokeWidth={3}
                    />
                  ) : (
                    <X
                      className="h-3.5 w-3.5 text-text-3"
                      strokeWidth={3}
                    />
                  )}
                </span>
                <span
                  className={`text-[13px] ${
                    p.allowed ? "text-text-1" : "text-text-3 line-through"
                  }`}
                >
                  {p.label}
                </span>
              </li>
            ))}
          </ul>
        </Section>

        {/* Connected providers (legacy onboarding-time keys) */}
        <Section title="Language Model Providers" icon={Key}>
          {data.providers.length === 0 ? (
            <p className="text-[13px] text-text-3">
              No providers connected. Manage API keys in Management →
              Integration.
            </p>
          ) : (
            <ul className="flex flex-col gap-2">
              {data.providers.map((p) => (
                <li
                  key={p.id}
                  className="flex items-center justify-between rounded border border-bg-1 bg-bg-1/40 px-3 py-2"
                >
                  <span className="text-[13px] font-medium text-text-1">
                    {PROVIDER_LABELS[p.provider] ?? p.provider}
                  </span>
                  <span className="text-[12px] text-text-3">
                    •••• connected
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Section>

        {/* Knowledge documents */}
        <Section title="Knowledge Documents" icon={FileText}>
          {data.documents.length === 0 ? (
            <p className="text-[13px] text-text-3">
              No documents uploaded yet.
            </p>
          ) : (
            <ul className="flex flex-col gap-2">
              {data.documents.map((d) => (
                <li
                  key={d.id}
                  className="flex items-center justify-between gap-3 rounded border border-bg-1 bg-bg-1/40 px-3 py-2"
                >
                  <div className="flex min-w-0 flex-col">
                    <span className="truncate text-[13px] font-medium text-text-1">
                      {d.filename}
                    </span>
                    <span className="text-[12px] text-text-3">
                      {d.mimeType ?? "unknown"} • {formatBytes(d.sizeBytes)}
                    </span>
                  </div>
                  {/* Same-origin credential cookies are set on the API host,
                      so a direct anchor to the API carries auth. */}
                  <a
                    href={`${API_URL}/onboarding/documents/${d.id}/download`}
                    className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md px-2.5 text-[12px] font-medium text-primary-6 transition-colors hover:bg-primary-1/40"
                    title={`Download ${d.filename}`}
                  >
                    <Download className="h-3.5 w-3.5" />
                    Download
                  </a>
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>
    </div>
  );
}
