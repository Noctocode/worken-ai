"use client";

import {
  ArrowRight,
  Cloud,
  Cpu,
  Database,
  Server,
  ShieldCheck,
} from "lucide-react";
import { useLanguage } from "@/lib/i18n";
import type { TranslationKey } from "@/lib/translations/en";

/* ─── Diagram primitives ─────────────────────────────────────────────
 * Hand-built box + boundary diagrams (no diagram lib) so they follow
 * the theme tokens and dark/light mode. Three deployment models, each
 * shown as components inside or outside the "customer boundary".
 */

function Chip({
  icon: Icon,
  label,
}: {
  icon: typeof Server;
  label: string;
}) {
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

export default function HowItWorksPage() {
  const { t } = useLanguage();

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

  return (
    <div className="flex flex-col gap-6 py-6">
      <p className="max-w-[720px] text-[15px] leading-[1.6] text-text-2">
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
    </div>
  );
}
