"use client";

import { useState } from "react";
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
} from "lucide-react";
import {
  PageTabs,
  PageTabsContent,
  PageTabsList,
  PageTabsTrigger,
} from "@/components/ui/page-tabs";
import { useLanguage } from "@/lib/i18n";
import { OVERVIEW_TEXT, type OverviewKey } from "./system-overview.i18n";

/* Internal developer documentation — "How the system fits together".
 *
 * This whole component is gated server-side: the parent page only renders it
 * when /auth/me reports `user.isInternal` (the @noctocode.com rule lives on
 * the API). It is pulled in via `next/dynamic`, so its JS chunk is never
 * fetched for non-internal users — the diagrams are not shipped to them. */

const OVERVIEW_TABS: Array<{
  value: string;
  labelKey: OverviewKey;
  descKey: OverviewKey;
  pointsKeys: OverviewKey[];
}> = [
  {
    value: "nav",
    labelKey: "resources.overview.tab.nav",
    descKey: "resources.overview.nav.desc",
    pointsKeys: [
      "resources.overview.nav.p1",
      "resources.overview.nav.p2",
      "resources.overview.nav.p3",
    ],
  },
  {
    value: "architecture",
    labelKey: "resources.overview.tab.architecture",
    descKey: "resources.overview.architecture.desc",
    pointsKeys: [
      "resources.overview.architecture.p1",
      "resources.overview.architecture.p2",
      "resources.overview.architecture.p3",
    ],
  },
  {
    value: "entities",
    labelKey: "resources.overview.tab.entities",
    descKey: "resources.overview.entities.desc",
    pointsKeys: [
      "resources.overview.entities.p1",
      "resources.overview.entities.p2",
      "resources.overview.entities.p3",
    ],
  },
  {
    value: "roles",
    labelKey: "resources.overview.tab.roles",
    descKey: "resources.overview.roles.desc",
    pointsKeys: [
      "resources.overview.roles.p1",
      "resources.overview.roles.p2",
      "resources.overview.roles.p3",
    ],
  },
  {
    value: "flow",
    labelKey: "resources.overview.tab.flow",
    descKey: "resources.overview.flow.desc",
    pointsKeys: [
      "resources.overview.flow.p1",
      "resources.overview.flow.p2",
      "resources.overview.flow.p3",
    ],
  },
];

/* Glossary terms shown below the tabs — shorthand used across the
 * diagrams and the product. Term + definition are both translation keys. */
const GLOSSARY: Array<{ term: OverviewKey; def: OverviewKey }> = [
  {
    term: "resources.overview.glossary.byok",
    def: "resources.overview.glossary.byokDef",
  },
  {
    term: "resources.overview.glossary.gateway",
    def: "resources.overview.glossary.gatewayDef",
  },
  {
    term: "resources.overview.glossary.rag",
    def: "resources.overview.glossary.ragDef",
  },
  {
    term: "resources.overview.glossary.guardrail",
    def: "resources.overview.glossary.guardrailDef",
  },
  {
    term: "resources.overview.glossary.kc",
    def: "resources.overview.glossary.kcDef",
  },
  {
    term: "resources.overview.glossary.skill",
    def: "resources.overview.glossary.skillDef",
  },
  {
    term: "resources.overview.glossary.scope",
    def: "resources.overview.glossary.scopeDef",
  },
  {
    term: "resources.overview.glossary.observability",
    def: "resources.overview.glossary.observabilityDef",
  },
];

/* ─── Diagram primitives ─────────────────────────────────────────────
 * Hand-built boxes (no diagram lib) so they follow the theme tokens and
 * dark/light mode. */

/* A labeled box node. Optional `sub` adds a small second line of detail;
 * `accent` highlights the primary path, `muted` is for secondary items. */
function Node({
  icon: Icon,
  label,
  sub,
  tone = "default",
}: {
  icon?: typeof Server;
  label: string;
  sub?: string;
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
      <div className="flex flex-col">
        <span className="text-[13px] font-medium leading-snug">{label}</span>
        {sub ? (
          <span className="text-[11px] leading-snug text-text-3">{sub}</span>
        ) : null}
      </div>
    </div>
  );
}

/* Flow connector. Points down when nodes stack (mobile), right on sm+.
 * Optional `label` shows a tiny note (e.g. cardinality) by the arrow. */
function Arrow({ label }: { label?: string }) {
  return (
    <div className="flex shrink-0 flex-col items-center justify-center">
      <ArrowRight
        className="h-5 w-5 rotate-90 text-text-3 sm:rotate-0"
        strokeWidth={2}
      />
      {label ? (
        <span className="text-[10px] leading-none text-text-3">{label}</span>
      ) : null}
    </div>
  );
}

/* A labeled column grouping related nodes. */
function Lane({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-1 flex-col rounded-lg border border-border-2 bg-bg-1 p-4">
      <div className="mb-3 text-[11px] font-semibold uppercase tracking-wide text-text-3">
        {label}
      </div>
      <div className="flex flex-col gap-2">{children}</div>
    </div>
  );
}

export default function SystemOverview() {
  const { t, language } = useLanguage();
  // Overview copy lives in a local, lazily-loaded module (not the global
  // translation bundle) so it never ships to non-internal users. `to` is
  // the local equivalent of `t` for those keys, with per-key en fallback.
  const to = (k: OverviewKey): string =>
    OVERVIEW_TEXT[language]?.[k] ?? OVERVIEW_TEXT.en[k];
  const many = to("resources.overview.ent.cardMany");
  const [active, setActive] = useState<string>(OVERVIEW_TABS[0].value);

  // System-overview diagrams, one per tab value.
  const diagrams: Record<string, React.ReactNode> = {
    // 1. Navigation — the sidebar groups (page names reuse the real
    //    sidebar labels) plus the admin-only section.
    nav: (
      <div className="flex flex-col gap-3 sm:flex-row">
        <Lane label={to("resources.overview.nav.core")}>
          <Node label={t("sidebar.nav.ongoingProjects")} />
          <Node label={t("sidebar.nav.modelArena")} />
          <Node label={t("sidebar.nav.observability")} />
          <Node label={t("sidebar.nav.teamManagement")} />
        </Lane>
        <Lane label={to("resources.overview.nav.features")}>
          <Node label={t("sidebar.nav.tenderAI")} />
          <Node label={t("sidebar.nav.aiCron")} />
          <Node label={t("sidebar.nav.knowledgeCore")} />
        </Lane>
        <Lane label={to("resources.overview.nav.tools")}>
          <Node label={t("sidebar.nav.toolkit")} />
          <Node label={t("sidebar.nav.learning")} />
        </Lane>
        <Lane label={to("resources.overview.nav.adminLane")}>
          <Node label={to("resources.overview.nav.guardrails")} tone="muted" />
          <Node
            label={to("resources.overview.nav.companySettings")}
            tone="muted"
          />
        </Lane>
      </div>
    ),

    // 2. Architecture — browser → API → data + external services.
    architecture: (
      <div className="flex flex-col items-stretch gap-3 lg:flex-row lg:items-center">
        <Node
          icon={Monitor}
          label={to("resources.overview.arch.browser")}
          sub={to("resources.overview.arch.browserSub")}
          tone="accent"
        />
        <Arrow />
        <Node
          icon={Server}
          label={to("resources.overview.arch.api")}
          sub={to("resources.overview.arch.apiSub")}
          tone="accent"
        />
        <Arrow />
        <div className="flex flex-1 flex-col gap-3">
          <Lane label={to("resources.overview.arch.dataLane")}>
            <Node
              icon={Database}
              label={to("resources.overview.arch.db")}
              sub={to("resources.overview.arch.dbSub")}
            />
            <Node
              icon={Gauge}
              label={to("resources.overview.arch.cache")}
              sub={to("resources.overview.arch.cacheSub")}
            />
          </Lane>
          <Lane label={to("resources.overview.arch.externalLane")}>
            <Node
              icon={Cpu}
              label={to("resources.overview.arch.models")}
              sub={to("resources.overview.arch.modelsSub")}
            />
            <Node icon={Cloud} label={to("resources.overview.arch.cloud")} />
            <Node
              icon={CloudSun}
              label={to("resources.overview.arch.arso")}
              sub={to("resources.overview.arch.arsoSub")}
            />
          </Lane>
        </div>
      </div>
    ),

    // 3. Entities — the company → … → message chain (1→many) + resources.
    entities: (
      <div className="flex flex-col gap-4">
        <div className="flex flex-col items-stretch gap-2 sm:flex-row sm:flex-wrap sm:items-center">
          <Node label={to("resources.overview.ent.company")} tone="accent" />
          <Arrow label={many} />
          <Node label={to("resources.overview.ent.team")} tone="accent" />
          <Arrow label={many} />
          <Node
            label={to("resources.overview.ent.project")}
            sub={to("resources.overview.ent.projectSub")}
            tone="accent"
          />
          <Arrow label={many} />
          <Node
            label={to("resources.overview.ent.conversation")}
            sub={to("resources.overview.ent.conversationSub")}
          />
          <Arrow label={many} />
          <Node label={to("resources.overview.ent.message")} />
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
          <Node label={to("resources.overview.ent.users")} tone="muted" />
          <Node label={to("resources.overview.ent.knowledge")} tone="muted" />
          <Node label={to("resources.overview.ent.integrations")} tone="muted" />
          <Node label={to("resources.overview.ent.docs")} tone="muted" />
        </div>
      </div>
    ),

    // 4. Roles — org roles (with what each can do) + the scope cascade.
    roles: (
      <div className="flex flex-col gap-3 sm:flex-row">
        <Lane label={to("resources.overview.roles.orgLane")}>
          <Node
            label={to("resources.overview.roles.admin")}
            sub={to("resources.overview.roles.adminSub")}
            tone="accent"
          />
          <Node
            label={to("resources.overview.roles.advanced")}
            sub={to("resources.overview.roles.advancedSub")}
          />
          <Node
            label={to("resources.overview.roles.basic")}
            sub={to("resources.overview.roles.basicSub")}
            tone="muted"
          />
        </Lane>
        <Lane label={to("resources.overview.roles.scopeLane")}>
          <div className="flex flex-col items-stretch gap-2 sm:flex-row sm:items-center">
            <Node label={to("resources.overview.ent.company")} />
            <Arrow />
            <Node label={to("resources.overview.ent.team")} />
            <Arrow />
            <Node label={to("resources.overview.ent.project")} />
          </div>
          <Node label={to("resources.overview.roles.cascade")} tone="muted" />
          <Node
            label={to("resources.overview.roles.budgetCascade")}
            tone="muted"
          />
          <Node label={to("resources.overview.roles.teamRoles")} tone="muted" />
          <Node
            label={to("resources.overview.roles.projectRoles")}
            tone="muted"
          />
        </Lane>
      </div>
    ),

    // 5. Key flow — the chat message pipeline, with a note on key steps.
    flow: (
      <div className="flex flex-col items-stretch gap-2 sm:flex-row sm:flex-wrap sm:items-center">
        <Node label={to("resources.overview.flow.message")} tone="accent" />
        <Arrow />
        <Node
          label={to("resources.overview.flow.inputGuard")}
          sub={to("resources.overview.flow.inputGuardSub")}
        />
        <Arrow />
        <Node
          label={to("resources.overview.flow.context")}
          sub={to("resources.overview.flow.contextSub")}
        />
        <Arrow />
        <Node label={to("resources.overview.flow.budget")} />
        <Arrow />
        <Node
          label={to("resources.overview.flow.model")}
          sub={to("resources.overview.flow.modelSub")}
          tone="accent"
        />
        <Arrow />
        <Node
          label={to("resources.overview.flow.outputGuard")}
          sub={to("resources.overview.flow.outputGuardSub")}
        />
        <Arrow />
        <Node
          label={to("resources.overview.flow.save")}
          sub={to("resources.overview.flow.saveSub")}
        />
        <Arrow />
        <Node label={to("resources.overview.flow.answer")} tone="accent" />
      </div>
    ),
  };

  return (
    <section className="flex flex-col gap-4 border-t border-border-2 pt-6">
      <div className="flex flex-col items-start gap-2">
        <span className="inline-flex items-center gap-2 rounded-full border border-primary-6/25 bg-primary-1/70 py-1 pl-1.5 pr-3 text-[11px] font-semibold tracking-wide text-primary-7 shadow-sm">
          <span className="flex h-5 w-5 items-center justify-center rounded-full bg-primary-6/15 text-primary-6">
            <Lock className="h-3 w-3" strokeWidth={2.5} />
          </span>
          {to("resources.overview.devOnly")}
        </span>
        <div className="flex flex-col gap-1">
          <h2 className="text-[20px] font-bold leading-[1.4] text-text-1">
            {to("resources.overview.heading")}
          </h2>
          <p className="text-[14px] leading-[1.6] text-text-2">
            {to("resources.overview.intro")}
          </p>
        </div>
      </div>

      <PageTabs value={active} onValueChange={setActive} className="gap-5">
        <PageTabsList>
          {OVERVIEW_TABS.map((tb) => (
            <PageTabsTrigger key={tb.value} value={tb.value}>
              {to(tb.labelKey)}
            </PageTabsTrigger>
          ))}
        </PageTabsList>

        {/* All panels are force-mounted Radix tabpanels sharing one grid
            cell, so the box is always sized to the TALLEST tab and Radix
            still wires the trigger↔panel ARIA (role=tabpanel, aria-
            labelledby, the trigger's aria-controls). The `flex` class beats
            the UA `[hidden]{display:none}` so inactive panels stay in
            layout (fixed height); since that defeats `hidden` as the AT-
            hiding mechanism, inactive panels are hidden from assistive tech
            EXPLICITLY via `aria-hidden`, and visually via
            `data-[state=inactive]:invisible`. */}
        <div className="grid">
          {OVERVIEW_TABS.map((tb) => (
            <PageTabsContent
              key={tb.value}
              value={tb.value}
              forceMount
              aria-hidden={tb.value !== active}
              className="col-start-1 row-start-1 flex flex-col gap-5 rounded-lg border border-border-2 bg-bg-white p-6 data-[state=inactive]:invisible"
            >
              <div className="overflow-x-auto">{diagrams[tb.value]}</div>
              <p className="text-[13px] leading-[1.6] text-text-2">
                {to(tb.descKey)}
              </p>
              <div className="flex flex-col gap-1.5">
                <div className="text-[11px] font-semibold uppercase tracking-wide text-text-3">
                  {to("resources.overview.keyPoints")}
                </div>
                <ul className="flex flex-col gap-1">
                  {tb.pointsKeys.map((pk) => (
                    <li
                      key={pk}
                      className="flex gap-2 text-[13px] leading-[1.5] text-text-2"
                    >
                      <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-primary-6" />
                      {to(pk)}
                    </li>
                  ))}
                </ul>
              </div>
            </PageTabsContent>
          ))}
        </div>
      </PageTabs>

      {/* ── Extra reference, below the tabs ───────────────────────────
          Static sections (no tab state) that round out the diagrams: the
          stack the platform runs on, and a glossary of the shorthand used
          throughout. */}
      <div className="flex flex-col gap-8 border-t border-border-2 pt-6">
        {/* Tech stack */}
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <h3 className="text-[16px] font-bold leading-[1.4] text-text-1">
              {to("resources.overview.stack.heading")}
            </h3>
            <p className="text-[13px] leading-[1.6] text-text-2">
              {to("resources.overview.stack.intro")}
            </p>
          </div>
          <div className="overflow-x-auto">
            <div className="flex flex-col gap-3 sm:flex-row">
              <Lane label={to("resources.overview.stack.frontend")}>
                <Node label="Next.js (App Router)" />
                <Node label="React + Tailwind CSS" />
                <Node label="shadcn/ui" />
              </Lane>
              <Lane label={to("resources.overview.stack.backend")}>
                <Node label="NestJS" />
                <Node label="SSE streaming" />
                <Node label="Drizzle ORM" />
              </Lane>
              <Lane label={to("resources.overview.stack.data")}>
                <Node label="PostgreSQL 16 + pgvector" />
                <Node label="Redis" />
              </Lane>
              <Lane label={to("resources.overview.stack.tooling")}>
                <Node label="TypeScript" />
                <Node label="pnpm monorepo" />
              </Lane>
            </div>
          </div>
        </div>

        {/* Glossary */}
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <h3 className="text-[16px] font-bold leading-[1.4] text-text-1">
              {to("resources.overview.glossary.heading")}
            </h3>
            <p className="text-[13px] leading-[1.6] text-text-2">
              {to("resources.overview.glossary.intro")}
            </p>
          </div>
          <dl className="grid gap-x-8 gap-y-3 sm:grid-cols-2">
            {GLOSSARY.map((g) => (
              <div key={g.term} className="flex flex-col gap-0.5">
                <dt className="text-[13px] font-semibold leading-snug text-text-1">
                  {to(g.term)}
                </dt>
                <dd className="text-[13px] leading-[1.5] text-text-2">
                  {to(g.def)}
                </dd>
              </div>
            ))}
          </dl>
        </div>
      </div>
    </section>
  );
}
