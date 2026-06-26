"use client";

import {
  ArrowRight,
  Cloud,
  CloudSun,
  Cpu,
  Database,
  Gauge,
  Lock,
  Monitor,
  Server,
  ShieldCheck,
} from "lucide-react";
import {
  PageTabs,
  PageTabsContent,
  PageTabsList,
  PageTabsTrigger,
} from "@/components/ui/page-tabs";
import { useAuth } from "@/components/providers";
import { useLanguage } from "@/lib/i18n";
import type { TranslationKey } from "@/lib/translations/en";

/* System-overview tabs — one simple diagram + short description each. */
const OVERVIEW_TABS: Array<{
  value: string;
  labelKey: TranslationKey;
  descKey: TranslationKey;
}> = [
  {
    value: "nav",
    labelKey: "resources.overview.tab.nav",
    descKey: "resources.overview.nav.desc",
  },
  {
    value: "architecture",
    labelKey: "resources.overview.tab.architecture",
    descKey: "resources.overview.architecture.desc",
  },
  {
    value: "entities",
    labelKey: "resources.overview.tab.entities",
    descKey: "resources.overview.entities.desc",
  },
  {
    value: "roles",
    labelKey: "resources.overview.tab.roles",
    descKey: "resources.overview.roles.desc",
  },
  {
    value: "flow",
    labelKey: "resources.overview.tab.flow",
    descKey: "resources.overview.flow.desc",
  },
];

/* ─── Diagram primitives ─────────────────────────────────────────────
 * Hand-built box + boundary diagrams (no diagram lib) so they follow
 * the theme tokens and dark/light mode. Used both by the three
 * deployment cards and the system-overview tabs below.
 */

function Chip({ icon: Icon, label }: { icon: typeof Server; label: string }) {
  return (
    <div className="flex items-center gap-2 rounded-md border border-border-2 bg-bg-white px-3 py-2">
      <Icon className="h-4 w-4 shrink-0 text-primary-7" strokeWidth={2} />
      <span className="text-[13px] leading-snug text-text-1">{label}</span>
    </div>
  );
}

function Boundary({
  label,
  tone,
  children,
}: {
  label: string;
  tone: "internal" | "cloud";
  children: React.ReactNode;
}) {
  const frame =
    tone === "internal"
      ? "border-success-7/50 bg-success-1/20"
      : "border-primary-6/50 bg-primary-1/30";
  const text = tone === "internal" ? "text-success-7" : "text-primary-7";
  return (
    <div className={`flex-1 rounded-lg border-2 border-dashed p-4 ${frame}`}>
      <div className={`mb-3 text-[11px] font-semibold uppercase tracking-wide ${text}`}>
        {label}
      </div>
      <div className="flex flex-wrap gap-2">{children}</div>
    </div>
  );
}

/* A labeled box node. `accent` highlights the primary path, `muted` is
 * for secondary/attached items. */
function Node({
  icon: Icon,
  label,
  tone = "default",
}: {
  icon?: typeof Server;
  label: string;
  tone?: "default" | "accent" | "muted";
}) {
  const styles =
    tone === "accent"
      ? "border-primary-6/50 bg-primary-1/30 text-text-1"
      : tone === "muted"
        ? "border-border-2 bg-bg-1 text-text-2"
        : "border-border-2 bg-bg-white text-text-1";
  return (
    <div
      className={`flex items-center gap-2 rounded-md border px-3 py-2 ${styles}`}
    >
      {Icon ? (
        <Icon className="h-4 w-4 shrink-0 text-primary-7" strokeWidth={2} />
      ) : null}
      <span className="text-[13px] font-medium leading-snug">{label}</span>
    </div>
  );
}

/* Flow connector. Points down when nodes stack (mobile), right on sm+. */
function Arrow() {
  return (
    <ArrowRight
      className="mx-auto h-5 w-5 shrink-0 rotate-90 text-text-3 sm:rotate-0"
      strokeWidth={2}
    />
  );
}

/* A labeled column grouping related nodes. */
function Lane({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-1 flex-col rounded-lg border border-border-2 bg-bg-1 p-4">
      <div className="mb-3 text-[11px] font-semibold uppercase tracking-wide text-text-3">
        {label}
      </div>
      <div className="flex flex-col gap-2">{children}</div>
    </div>
  );
}

export default function HowItWorksPage() {
  const { t } = useLanguage();

  // The system-overview section is internal developer documentation — only
  // signed-in @noctocode.com members may see it. Client-side visibility gate:
  // the content is non-sensitive docs (diagrams), not protected data.
  const { user } = useAuth();
  const isNoctocodeMember =
    !!user?.email &&
    user.email.trim().toLowerCase().endsWith("@noctocode.com");

  const L = {
    infra: t("resources.how.label.infra"),
    cloud: t("resources.how.label.cloud"),
    app: t("resources.how.label.app"),
    data: t("resources.how.label.data"),
    model: t("resources.how.label.model"),
    external: t("resources.how.label.external"),
  };

  const cards: Array<{
    titleKey: TranslationKey;
    captionKey: TranslationKey;
    costKey: TranslationKey;
    diagram: React.ReactNode;
  }> = [
    {
      titleKey: "resources.how.onprem.title",
      captionKey: "resources.how.onprem.caption",
      costKey: "resources.how.onprem.cost",
      diagram: (
        <div className="flex">
          <Boundary label={L.infra} tone="internal">
            <Chip icon={Server} label={L.app} />
            <Chip icon={Database} label={L.data} />
            <Chip icon={Cpu} label={L.model} />
          </Boundary>
        </div>
      ),
    },
    {
      titleKey: "resources.how.hybrid.title",
      captionKey: "resources.how.hybrid.caption",
      costKey: "resources.how.hybrid.cost",
      diagram: (
        <div className="flex flex-col items-stretch gap-3 sm:flex-row sm:items-center">
          <Boundary label={L.infra} tone="internal">
            <Chip icon={Server} label={L.app} />
            <Chip icon={Database} label={L.data} />
          </Boundary>
          <ArrowRight className="mx-auto h-5 w-5 shrink-0 rotate-90 text-text-3 sm:rotate-0" />
          <div className="flex-1 rounded-lg border border-border-2 bg-bg-1 p-4">
            <div className="mb-3 text-[11px] font-semibold uppercase tracking-wide text-text-3">
              {L.external}
            </div>
            <Chip icon={Cpu} label={L.model} />
          </div>
        </div>
      ),
    },
    {
      titleKey: "resources.how.cloud.title",
      captionKey: "resources.how.cloud.caption",
      costKey: "resources.how.cloud.cost",
      diagram: (
        <div className="flex">
          <Boundary label={L.cloud} tone="cloud">
            <Chip icon={Server} label={L.app} />
            <Chip icon={Database} label={L.data} />
            <Chip icon={Cloud} label={L.model} />
          </Boundary>
        </div>
      ),
    },
  ];

  // System-overview diagrams, one per tab value.
  const diagrams: Record<string, React.ReactNode> = {
    // 1. Navigation — the three sidebar groups (page names reuse the
    //    real sidebar labels so this matches the live menu).
    nav: (
      <div className="flex flex-col gap-3 sm:flex-row">
        <Lane label={t("resources.overview.nav.core")}>
          <Node label={t("sidebar.nav.ongoingProjects")} />
          <Node label={t("sidebar.nav.modelArena")} />
          <Node label={t("sidebar.nav.observability")} />
          <Node label={t("sidebar.nav.teamManagement")} />
        </Lane>
        <Lane label={t("resources.overview.nav.features")}>
          <Node label={t("sidebar.nav.tenderAI")} />
          <Node label={t("sidebar.nav.aiCron")} />
          <Node label={t("sidebar.nav.knowledgeCore")} />
        </Lane>
        <Lane label={t("resources.overview.nav.tools")}>
          <Node label={t("sidebar.nav.toolkit")} />
          <Node label={t("sidebar.nav.learning")} />
        </Lane>
      </div>
    ),

    // 2. Architecture — browser → API → data + external services.
    architecture: (
      <div className="flex flex-col items-stretch gap-3 lg:flex-row lg:items-center">
        <Node icon={Monitor} label={t("resources.overview.arch.browser")} tone="accent" />
        <Arrow />
        <Node icon={Server} label={t("resources.overview.arch.api")} tone="accent" />
        <Arrow />
        <div className="flex flex-1 flex-col gap-3">
          <Lane label={t("resources.overview.arch.dataLane")}>
            <Node icon={Database} label={t("resources.overview.arch.db")} />
            <Node icon={Gauge} label={t("resources.overview.arch.cache")} />
          </Lane>
          <Lane label={t("resources.overview.arch.externalLane")}>
            <Node icon={Cpu} label={t("resources.overview.arch.models")} />
            <Node icon={Cloud} label={t("resources.overview.arch.cloud")} />
            <Node icon={CloudSun} label={t("resources.overview.arch.arso")} />
          </Lane>
        </div>
      </div>
    ),

    // 3. Entities — the company → … → message chain + linked resources.
    entities: (
      <div className="flex flex-col gap-4">
        <div className="flex flex-col items-stretch gap-2 sm:flex-row sm:flex-wrap sm:items-center">
          <Node label={t("resources.overview.ent.company")} tone="accent" />
          <Arrow />
          <Node label={t("resources.overview.ent.team")} tone="accent" />
          <Arrow />
          <Node label={t("resources.overview.ent.project")} tone="accent" />
          <Arrow />
          <Node label={t("resources.overview.ent.conversation")} />
          <Arrow />
          <Node label={t("resources.overview.ent.message")} />
        </div>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Node label={t("resources.overview.ent.users")} tone="muted" />
          <Node label={t("resources.overview.ent.attached")} tone="muted" />
        </div>
      </div>
    ),

    // 4. Roles — global org roles + the company→team→project scope.
    roles: (
      <div className="flex flex-col gap-3 sm:flex-row">
        <Lane label={t("resources.overview.roles.orgLane")}>
          <Node label={t("resources.overview.roles.admin")} tone="accent" />
          <Node label={t("resources.overview.roles.advanced")} />
          <Node label={t("resources.overview.roles.basic")} tone="muted" />
        </Lane>
        <Lane label={t("resources.overview.roles.scopeLane")}>
          <div className="flex flex-col items-stretch gap-2 sm:flex-row sm:items-center">
            <Node label={t("resources.overview.ent.company")} />
            <Arrow />
            <Node label={t("resources.overview.ent.team")} />
            <Arrow />
            <Node label={t("resources.overview.ent.project")} />
          </div>
          <Node label={t("resources.overview.roles.cascade")} tone="muted" />
          <Node label={t("resources.overview.roles.teamRoles")} tone="muted" />
          <Node label={t("resources.overview.roles.projectRoles")} tone="muted" />
        </Lane>
      </div>
    ),

    // 5. Key flow — the chat message pipeline.
    flow: (
      <div className="flex flex-col items-stretch gap-2 sm:flex-row sm:flex-wrap sm:items-center">
        <Node label={t("resources.overview.flow.message")} tone="accent" />
        <Arrow />
        <Node label={t("resources.overview.flow.inputGuard")} />
        <Arrow />
        <Node label={t("resources.overview.flow.context")} />
        <Arrow />
        <Node label={t("resources.overview.flow.budget")} />
        <Arrow />
        <Node label={t("resources.overview.flow.model")} tone="accent" />
        <Arrow />
        <Node label={t("resources.overview.flow.outputGuard")} />
        <Arrow />
        <Node label={t("resources.overview.flow.save")} />
        <Arrow />
        <Node label={t("resources.overview.flow.answer")} tone="accent" />
      </div>
    ),
  };

  return (
    <div className="flex flex-col gap-6 py-6">
      <p className="text-[15px] leading-[1.6] text-text-2">
        {t("resources.how.intro")}
      </p>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {cards.map((c) => (
          <div
            key={c.titleKey}
            className="flex flex-col gap-4 rounded-lg border border-border-2 bg-bg-white p-6"
          >
            <h3 className="text-[18px] font-bold leading-[1.4] text-text-1">
              {t(c.titleKey)}
            </h3>
            {c.diagram}
            <p className="text-[13px] leading-[1.6] text-text-2">
              {t(c.captionKey)}
            </p>
            <p className="mt-auto flex items-start gap-2 text-[12px] leading-[1.5] text-text-3">
              <ShieldCheck className="h-4 w-4 shrink-0 text-text-3" strokeWidth={2} />
              {t(c.costKey)}
            </p>
          </div>
        ))}
      </div>

      {/* ── System overview (internal, @noctocode.com only) ────────────
          New section BELOW the existing deployment cards. Gated to
          signed-in @noctocode.com members; a badge makes the dev-only
          visibility explicit. Subheading + tabs; each tab is one simple
          diagram + a short description. */}
      {isNoctocodeMember && (
      <section className="flex flex-col gap-4 border-t border-border-2 pt-6">
        <div className="flex flex-col items-start gap-2">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-warning-5 bg-warning-1 px-2.5 py-0.5 text-[11px] font-medium text-warning-7">
            <Lock className="h-3 w-3" strokeWidth={2} />
            {t("resources.overview.devOnly")}
          </span>
          <div className="flex flex-col gap-1">
            <h2 className="text-[20px] font-bold leading-[1.4] text-text-1">
              {t("resources.overview.heading")}
            </h2>
            <p className="text-[14px] leading-[1.6] text-text-2">
              {t("resources.overview.intro")}
            </p>
          </div>
        </div>

        <PageTabs defaultValue={OVERVIEW_TABS[0].value} className="gap-5">
          <PageTabsList>
            {OVERVIEW_TABS.map((tb) => (
              <PageTabsTrigger key={tb.value} value={tb.value}>
                {t(tb.labelKey)}
              </PageTabsTrigger>
            ))}
          </PageTabsList>
          {OVERVIEW_TABS.map((tb) => (
            <PageTabsContent key={tb.value} value={tb.value}>
              <div className="flex flex-col gap-5 rounded-lg border border-border-2 bg-bg-white p-6">
                <div className="overflow-x-auto">{diagrams[tb.value]}</div>
                <p className="text-[13px] leading-[1.6] text-text-2">
                  {t(tb.descKey)}
                </p>
              </div>
            </PageTabsContent>
          ))}
        </PageTabs>
      </section>
      )}
    </div>
  );
}
