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
import { useLanguage } from "@/lib/i18n";
import { buildIndustries, TEAM_SIZES, labelFor } from "@/lib/profile-options";

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
function getPlanDetails(
  plan: string,
  t: (key: import("@/lib/translations/en").TranslationKey) => string,
): { label: string; tagline: string; tone: "neutral" | "primary" | "premium" } {
  if (plan === "free") {
    return {
      label: t("mgmt.account.planFree"),
      tagline: t("mgmt.account.freeTagline"),
      tone: "neutral",
    };
  }
  return {
    label: plan
      .split(/[-_\s]+/)
      .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : ""))
      .join(" "),
    tagline: t("mgmt.account.customPlan"),
    tone: "neutral",
  };
}

function buildPermissions(
  role: "admin" | "advanced" | "basic",
  profileType: "company" | "personal" | null,
  t: (key: import("@/lib/translations/en").TranslationKey) => string,
) {
  const isAdvanced = role === "admin" || role === "advanced";
  const isAdmin = role === "admin";
  // Teams / invites / member removal are company-tenant operations.
  // A personal profile is a sole account with no org, and it gets
  // role:'admin' at onboarding too — so without this gate the list
  // would promise capabilities a personal user can't exercise (the
  // invite/remove flows are profileType-gated on the BE and hidden in
  // the Company tab). View + project creation apply to both profiles.
  const isCompany = profileType === "company";
  return [
    { label: t("mgmt.account.perm.view"), allowed: true },
    { label: t("mgmt.account.perm.createProjects"), allowed: isAdvanced },
    { label: t("mgmt.account.perm.createTeams"), allowed: isAdvanced && isCompany },
    { label: t("mgmt.account.perm.inviteUsers"), allowed: isAdvanced && isCompany },
    { label: t("mgmt.account.perm.removeUsers"), allowed: isAdmin && isCompany },
  ];
}

export function AccountTab() {
  const { t } = useLanguage();
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
        {t("mgmt.account.failedLoad")}
      </div>
    );
  }

  const ProfileIcon = data.profileType === "company" ? Building2 : UserRound;
  const InfraIcon = data.infraChoice === "on-premise" ? Server : Cloud;
  const role = currentUser?.role ?? "basic";
  const isAdvanced = role === "admin" || role === "advanced";
  const permissions = buildPermissions(
    role as "admin" | "advanced" | "basic",
    data.profileType,
    t,
  );

  return (
    <div className="py-5">
      {/* Section header — matches Teams / Users / Models pattern */}
      <div className="mb-5">
        <span className="text-[18px] font-bold text-black-900">
          {t("mgmt.account.title")}
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
            {role === "admin"
              ? t("mgmt.account.roleAdmin")
              : isAdvanced
                ? t("mgmt.account.roleAdvanced")
                : t("mgmt.account.roleBasic")}
          </Badge>
        </div>

        {/* 2-column row on lg+: Profile + Infrastructure */}
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Section
            title={
              data.profileType === "company"
                ? t("mgmt.account.companyProfile")
                : data.profileType === "personal"
                  ? t("mgmt.account.personalProfile")
                  : t("mgmt.account.profile")
            }
            icon={ProfileIcon}
          >
            {data.profileType === "company" && (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <Field label={t("mgmt.account.companyName")} value={data.companyName} />
                {/* industry/teamSize are stored as enum values
                    ("technology", "1-10"); map to the localized label
                    via the same catalog the Company tab editor uses so
                    the two surfaces never disagree. */}
                <Field
                  label={t("mgmt.account.industry")}
                  value={
                    data.industry
                      ? labelFor(buildIndustries(t), data.industry)
                      : null
                  }
                />
                <Field
                  label={t("mgmt.account.teamSize")}
                  value={data.teamSize ? labelFor(TEAM_SIZES, data.teamSize) : null}
                />
              </div>
            )}
            {data.profileType === "personal" && (
              <Field label={t("mgmt.account.fullName")} value={data.name} />
            )}
            {!data.profileType && (
              <p className="text-[13px] text-text-3">
                {t("mgmt.account.profileNotSet")}
              </p>
            )}
          </Section>

          <Section title={t("mgmt.account.infrastructure")} icon={InfraIcon}>
            <p className="text-[14px] text-text-1">
              {data.infraChoice === "managed"
                ? t("mgmt.account.managedCloud")
                : data.infraChoice === "on-premise"
                  ? t("mgmt.account.onPremise")
                  : t("mgmt.account.notSet")}
            </p>
          </Section>
        </div>

        {/* Plan — full width row showing the user's subscription tier
            plus an Upgrade CTA. The button currently fires a "Coming
            soon" toast — paid plans aren't built yet. Wire it up to a
            real upgrade flow once billing lands. */}
        <Section title={t("mgmt.account.plan")} icon={Sparkles}>
          {(() => {
            const planDetails = getPlanDetails(data.plan, t);
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
                  onClick={() => toast.info(t("mgmt.account.upgradeSoon"))}
                >
                  {t("mgmt.account.upgradeAccount")}
                </Button>
              </div>
            );
          })()}
        </Section>

        {/* Permissions — full width list */}
        <Section title={t("mgmt.account.accessTier")} icon={ShieldCheck}>
          <p className="mb-3 text-[13px] text-text-3">
            {isAdvanced
              ? t("mgmt.account.fullAccess")
              : t("mgmt.account.viewOnly")}
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
        <Section title={t("mgmt.account.providers")} icon={Key}>
          {data.providers.length === 0 ? (
            <p className="text-[13px] text-text-3">
              {t("mgmt.account.noProviders")}
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
                    {t("mgmt.account.connected")}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Section>

        {/* Knowledge documents */}
        <Section title={t("mgmt.account.knowledgeDocs")} icon={FileText}>
          {data.documents.length === 0 ? (
            <p className="text-[13px] text-text-3">
              {t("mgmt.account.noDocs")}
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
                      {d.fileType ?? "FILE"} • {formatBytes(d.sizeBytes)}
                    </span>
                  </div>
                  {/* Same-origin credential cookies are set on the API host,
                      so a direct anchor to the API carries auth. */}
                  <a
                    href={`${API_URL}/onboarding/documents/${d.id}/download`}
                    className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md px-2.5 text-[12px] font-medium text-primary-6 transition-colors hover:bg-primary-1/40"
                    title={`${t("mgmt.account.download")} ${d.filename}`}
                  >
                    <Download className="h-3.5 w-3.5" />
                    {t("mgmt.account.download")}
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
