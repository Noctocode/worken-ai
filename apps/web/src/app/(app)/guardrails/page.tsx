"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import {
  AlertTriangle,
  Check,
  CheckCircle,
  ChevronLeft,
  ChevronRight,
  Eye,
  Loader2,
  Pencil,
  Search,
  Shield,
  ShieldCheck,
  Trash2,
  X,
  Zap,
} from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  fetchGuardrailItems,
  fetchGuardrailStats,
  fetchComplianceTemplates,
  createGuardrailItem,
  updateGuardrailItem,
  toggleGuardrailItem,
  toggleGuardrailOrgWide,
  deleteGuardrailItem,
  applyComplianceTemplate,
  removeComplianceTemplate,
  type GuardrailItem,
  type GuardrailStats,
  type ComplianceTemplateItem,
} from "@/lib/api";
import { useAuth } from "@/components/providers";

type Tab = "overview" | "templates";
type Severity = "high" | "medium" | "low";

const SEVERITY_STYLES: Record<Severity, string> = {
  high: "bg-danger-1 text-danger-6",
  medium: "bg-warning-1 text-warning-6",
  low: "bg-success-1 text-success-7",
};

// Left-border accent that runs the height of each row in the
// guardrails table. Mirrors the severity pill colours so the row
// reads as "this is a high-severity rule" at a glance, without
// shouting on lower-severity rows. Empty for low so the table
// stays calm by default.
const SEVERITY_ROW_ACCENT: Record<Severity, string> = {
  high: "border-l-4 border-l-danger-6",
  medium: "border-l-4 border-l-warning-6",
  low: "border-l-4 border-l-transparent",
};

// Numeric weight used by the FE sort. Mirrors the CASE expression
// in GuardrailEvaluatorService.loadApplicableRules so the order
// admins see in the management list matches what the chat-time
// gate is going to evaluate.
const SEVERITY_WEIGHT: Record<Severity, number> = {
  high: 0,
  medium: 1,
  low: 2,
};

const PAGE_SIZE = 10;

const PII_ENTITIES = [
  "Credit Card",
  "Crypto",
  "Date Time",
  "Email Address",
  "IBAN Code",
  "IP Address",
  "NRP",
  "Location",
  "Person",
  "Phone Number",
];

const VALIDATOR_TYPES = [
  {
    id: "no_pii",
    name: "No PII",
    description:
      "Detect and anonymize Personally Identifiable Information (PII) in LLM-generated text",
  },
  {
    id: "regex_match",
    name: "Regex match",
    description: "Output follows a pre-specified regex rule",
  },
  {
    id: "detect_jailbreak",
    name: "Detect jailbreak",
    description: "Detect injection and jailbreak attempts",
  },
];

/* ─── Stats Card ─────────────────────────────────────────────────────── */

function StatCard({
  label,
  value,
  icon: Icon,
  iconBg,
}: {
  label: string;
  value: string;
  icon: typeof Shield;
  iconBg: string;
}) {
  return (
    <div className="flex flex-1 gap-3 rounded-[20px] bg-bg-white p-6 shadow-[0_1px_3px_rgba(0,0,0,0.06)]">
      <span
        className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${iconBg}`}
      >
        <Icon className="h-5 w-5" strokeWidth={2} />
      </span>
      <div className="flex flex-col">
        <span className="text-[24px] font-bold leading-tight text-text-1">
          {value}
        </span>
        <span className="text-[13px] text-text-2">{label}</span>
      </div>
    </div>
  );
}

/* ─── Overview Tab ───────────────────────────────────────────────────── */

function OverviewTab({
  guardrailsList,
  stats,
  isLoading,
  onToggle,
  onToggleOrgWide,
  onDelete,
  onEdit,
  canOrgWide,
}: {
  guardrailsList: GuardrailItem[];
  stats: GuardrailStats | undefined;
  isLoading: boolean;
  onToggle: (id: string) => void;
  onToggleOrgWide: (id: string) => void;
  onDelete: (id: string) => void;
  onEdit: (rule: GuardrailItem) => void;
  /** Org-wide is a company-only concept — for personal-profile users
   *  the Scope column collapses to inline team pills and hides the
   *  Switch. Passed through from the page so we don't re-call the
   *  auth hook inside the table component. */
  canOrgWide: boolean;
}) {
  const [query, setQuery] = useState("");
  const [severity, setSeverity] = useState<string>("all");
  const [timeFilter, setTimeFilter] = useState<string>("all");
  const [page, setPage] = useState(1);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const deleteName =
    guardrailsList.find((g) => g.id === deleteId)?.name ?? "";

  const filtered = useMemo(() => {
    let list = guardrailsList;
    if (severity !== "all") {
      list = list.filter((g) => g.severity === severity);
    }
    if (timeFilter !== "all") {
      const now = Date.now();
      const cutoff = {
        "24h": now - 24 * 60 * 60 * 1000,
        "7d": now - 7 * 24 * 60 * 60 * 1000,
        "30d": now - 30 * 24 * 60 * 60 * 1000,
      }[timeFilter];
      if (cutoff) {
        list = list.filter((g) => new Date(g.createdAt).getTime() >= cutoff);
      }
    }
    const q = query.trim().toLowerCase();
    if (q) {
      list = list.filter(
        (g) =>
          g.name.toLowerCase().includes(q) ||
          g.type.toLowerCase().includes(q),
      );
    }
    // Default sort matches the BE evaluator: severity high → low
    // first, then newest within the same severity. Keeps the
    // management list in the same order chat-time rules fire so
    // admins debugging "why did rule X win" don't have to mentally
    // re-sort. id is the deterministic tiebreaker for two rules
    // created at the same instant (rare, but possible on bulk-
    // applied templates).
    return [...list].sort((a, b) => {
      const sevDelta = SEVERITY_WEIGHT[a.severity] - SEVERITY_WEIGHT[b.severity];
      if (sevDelta !== 0) return sevDelta;
      const dateDelta =
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      if (dateDelta !== 0) return dateDelta;
      return a.id.localeCompare(b.id);
    });
  }, [guardrailsList, query, severity, timeFilter]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const paginated = filtered.slice(
    (page - 1) * PAGE_SIZE,
    page * PAGE_SIZE,
  );

  if (isLoading) {
    return (
      <div className="flex flex-1 items-center justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-text-3" />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Stats */}
      <div className="flex flex-wrap gap-4">
        <StatCard
          label="Active Rules"
          value={String(stats?.activeRules ?? 0)}
          icon={ShieldCheck}
          iconBg="bg-primary-1 text-primary-6"
        />
        <StatCard
          label="Total Triggers"
          value={(stats?.totalTriggers ?? 0).toLocaleString()}
          icon={Zap}
          iconBg="bg-warning-1 text-warning-6"
        />
        <StatCard
          label="Critical Rules"
          value={String(stats?.criticalRules ?? 0)}
          icon={AlertTriangle}
          iconBg="bg-danger-1 text-danger-6"
        />
        <StatCard
          label="Coverage"
          value={`${stats?.coverage ?? 0}%`}
          icon={Eye}
          iconBg="bg-success-1 text-success-7"
        />
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-6">
        <h3 className="text-[18px] font-bold text-text-1">All Guardrails</h3>
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-text-3" />
          <Input
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setPage(1);
            }}
            placeholder="Search guardrails..."
            className="h-12 rounded-xl border-border-3 bg-bg-white pl-12 text-[16px] placeholder:text-text-3"
          />
        </div>
        <div className="flex items-center gap-4">
          <Select
            value={severity}
            onValueChange={(v) => {
              setSeverity(v);
              setPage(1);
            }}
          >
            <SelectTrigger className="cursor-pointer gap-2 rounded-lg border-border-2 bg-bg-white px-6 text-[16px] data-[size=default]:h-12">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Severities</SelectItem>
              <SelectItem value="high">High</SelectItem>
              <SelectItem value="medium">Medium</SelectItem>
              <SelectItem value="low">Low</SelectItem>
            </SelectContent>
          </Select>
          <Select value={timeFilter} onValueChange={setTimeFilter}>
            <SelectTrigger className="cursor-pointer gap-2 rounded-lg border-border-2 bg-bg-white px-6 text-[16px] data-[size=default]:h-12">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="24h">Last 24h</SelectItem>
              <SelectItem value="7d">Last 7 days</SelectItem>
              <SelectItem value="30d">Last 30 days</SelectItem>
              <SelectItem value="all">All time</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Table */}
      <div className="overflow-hidden rounded-[20px]">
        <table className="w-full text-left text-[13px]">
          <thead>
            <tr className="border-b border-border-2 text-[14px] font-medium text-text-2">
              <th className="px-4 py-2 font-medium">Name</th>
              <th className="px-4 py-2 font-medium">Type</th>
              <th className="px-4 py-2 font-medium">Severity</th>
              <th className="px-4 py-2 font-medium">Triggers</th>
              <th className="px-4 py-2 font-medium">Scope</th>
              <th className="px-4 py-2 font-medium">Status</th>
              <th className="px-4 py-2 font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {paginated.map((g) => (
              <tr
                key={g.id}
                className={`border-b border-border-2 last:border-b-0 transition-colors hover:bg-bg-1 ${SEVERITY_ROW_ACCENT[g.severity]}`}
              >
                <td className="px-4 py-6">
                  <span className="font-medium text-text-1">{g.name}</span>
                </td>
                <td className="px-6 py-4 text-text-2">{g.type}</td>
                <td className="px-4 py-6">
                  <span
                    className={`inline-flex rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${SEVERITY_STYLES[g.severity]}`}
                  >
                    {g.severity}
                  </span>
                </td>
                <td className="px-6 py-4 text-text-2">
                  {g.triggers.toLocaleString()}
                </td>
                <td className="px-4 py-6">
                  {/* Scope cell. For company users: Switch + visible
                      state (Org-wide pill when ON; team pill stack
                      when OFF). For personal users: just the team
                      pills (no switch — org-wide has no meaning
                      without a company). */}
                  <div className="flex items-center gap-3">
                    {canOrgWide && (
                      <button
                        type="button"
                        role="switch"
                        aria-checked={g.isOrgWide}
                        aria-label={`Toggle Org-wide for ${g.name}`}
                        onClick={() => onToggleOrgWide(g.id)}
                        title={
                          g.isOrgWide
                            ? "Org-wide ON — rule fires for every chat in your company. Click to turn off and restore per-team scope."
                            : "Turn on Org-wide to apply this rule to every chat in your company, regardless of team."
                        }
                        className={`flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full px-0.5 transition-colors ${
                          g.isOrgWide ? "bg-primary-6" : "bg-text-3"
                        }`}
                      >
                        <span
                          className={`block h-5 w-5 rounded-full bg-bg-white transition-transform ${
                            g.isOrgWide ? "translate-x-5" : "translate-x-0"
                          }`}
                        />
                      </button>
                    )}
                    {g.isOrgWide ? (
                      <span className="rounded-full bg-primary-1 px-2 py-0.5 text-[11px] font-medium text-primary-6">
                        Org-wide
                      </span>
                    ) : g.teams.length > 0 ? (
                      <div className="flex flex-wrap gap-1">
                        {g.teams.map((t) => (
                          <span
                            key={t.id}
                            className={`rounded-full px-2 py-0.5 text-[11px] ${
                              t.isActive
                                ? "bg-bg-1 text-text-3"
                                : "bg-bg-1 text-text-3 opacity-60"
                            }`}
                            title={t.isActive ? t.name : `${t.name} (paused)`}
                          >
                            {t.name}
                          </span>
                        ))}
                      </div>
                    ) : (
                      <span className="text-[11px] text-text-3">
                        Personal
                      </span>
                    )}
                  </div>
                </td>
                <td className="px-4 py-6">
                  <button
                    type="button"
                    role="switch"
                    aria-checked={g.isActive}
                    aria-label={`Toggle ${g.name}`}
                    onClick={() => onToggle(g.id)}
                    className={`flex h-6 w-11 cursor-pointer items-center rounded-full px-0.5 transition-colors ${
                      g.isActive ? "bg-primary-6" : "bg-text-3"
                    }`}
                  >
                    <span
                      className={`block h-5 w-5 rounded-full bg-bg-white transition-transform ${
                        g.isActive ? "translate-x-5" : "translate-x-0"
                      }`}
                    />
                  </button>
                </td>
                <td className="px-4 py-6">
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => onEdit(g)}
                      className="flex h-7 w-7 cursor-pointer items-center justify-center rounded text-text-3 transition-colors hover:bg-bg-1 hover:text-primary-6"
                      title="Edit"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => setDeleteId(g.id)}
                      className="flex h-7 w-7 cursor-pointer items-center justify-center rounded text-text-3 transition-colors hover:bg-danger-1 hover:text-danger-6"
                      title="Delete"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {paginated.length === 0 && (
              <tr>
                <td
                  colSpan={7}
                  className="px-6 py-10 text-center text-[13px] text-text-3"
                >
                  No guardrails found.
                </td>
              </tr>
            )}
          </tbody>
        </table>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between border-t border-border-2 px-6 py-3">
            <Button
              variant="outline"
              className="cursor-pointer gap-1.5 text-[13px]"
              disabled={page <= 1}
              onClick={() => setPage((p) => p - 1)}
            >
              <ChevronLeft className="h-3.5 w-3.5" />
              Previous
            </Button>
            <div className="flex items-center gap-1">
              {Array.from({ length: totalPages }, (_, i) => i + 1).map(
                (p) => (
                  <button
                    key={p}
                    type="button"
                    onClick={() => setPage(p)}
                    className={`flex h-8 w-8 cursor-pointer items-center justify-center rounded text-[13px] transition-colors ${
                      p === page
                        ? "bg-primary-6 font-semibold text-white"
                        : "text-text-2 hover:bg-bg-1"
                    }`}
                  >
                    {p}
                  </button>
                ),
              )}
            </div>
            <Button
              variant="outline"
              className="cursor-pointer gap-1.5 text-[13px]"
              disabled={page >= totalPages}
              onClick={() => setPage((p) => p + 1)}
            >
              Next
              <ChevronRight className="h-3.5 w-3.5" />
            </Button>
          </div>
        )}
      </div>

      {/* Delete dialog */}
      <Dialog
        open={deleteId !== null}
        onOpenChange={(open) => !open && setDeleteId(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Guardrail</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete{" "}
              <strong>{deleteName}</strong>? This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              onClick={() => setDeleteId(null)}
              className="cursor-pointer"
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                if (deleteId) {
                  onDelete(deleteId);
                  setDeleteId(null);
                }
              }}
              className="cursor-pointer"
            >
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/* ─── Compliance Templates Tab ───────────────────────────────────────── */

function TemplatesTab({
  templates,
  isLoading,
  appliedTemplateIds,
  onApply,
  onDisable,
}: {
  templates: ComplianceTemplateItem[];
  isLoading: boolean;
  appliedTemplateIds: Set<string>;
  onApply: (templateId: string) => void;
  onDisable: (templateId: string) => void;
}) {
  if (isLoading) {
    return (
      <div className="flex flex-1 items-center justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-text-3" />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {templates.map((t) => (
        <div
          key={t.id}
          className="flex flex-col gap-4 rounded-[20px] border border-border-3 bg-bg-white p-6"
        >
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-4">
              <Shield className="h-[18px] w-[18px] shrink-0 text-primary-6" />
              <div className="flex flex-col">
                <h3 className="text-[18px] font-bold text-text-1">{t.name}</h3>
                <span className="text-[13px] font-normal text-text-3">
                  {t.ruleCount} rules
                </span>
              </div>
            </div>
            {appliedTemplateIds.has(t.id) ? (
              <Button
                onClick={() => onDisable(t.id)}
                variant="outline"
                className="cursor-pointer rounded-lg border-border-3 px-6 py-2 text-[16px] font-normal text-text-2 hover:bg-bg-1"
              >
                Disable
              </Button>
            ) : (
              <Button
                onClick={() => onApply(t.id)}
                className="cursor-pointer rounded-lg bg-primary-6 px-6 py-2 text-[16px] font-normal text-white hover:bg-primary-7"
              >
                Apply
              </Button>
            )}
          </div>
          <p className="text-[14px] font-normal text-text-3">{t.description}</p>
          <div className="flex flex-col gap-2.5">
            <span className="text-[16px] font-normal text-text-1">Features:</span>
            {t.features.map((f) => (
              <div
                key={f}
                className="flex items-center gap-2.5"
              >
                <CheckCircle className="h-3.5 w-3.5 shrink-0 text-primary-6" />
                <span className="text-[14px] font-normal text-text-3">{f}</span>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

/* ─── Add Guardrail Dialog ───────────────────────────────────────────── */

function AddGuardrailDialog({
  open,
  onOpenChange,
  onSubmit,
  isPending,
  // When set, the dialog flips into edit mode: header copy changes,
  // submit button reads "Save", and form state is seeded from this
  // rule on open. The parent decides whether to call createMutation
  // or updateMutation based on whether `initial` is null.
  initial,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onSubmit: (data: {
    name: string;
    type: string;
    severity: "high" | "medium" | "low";
    validatorType: string;
    entities: string[];
    pattern?: string;
    target: "input" | "output" | "both";
    onFail: "fix" | "exception";
  }) => void;
  isPending: boolean;
  initial?: GuardrailItem | null;
}) {
  const [name, setName] = useState("");
  const [severity, setSeverity] = useState<"high" | "medium" | "low">("high");
  const [validatorType, setValidatorType] = useState("no_pii");
  const [selectedEntities, setSelectedEntities] = useState<Set<string>>(
    new Set(PII_ENTITIES),
  );
  // Free-form regex pattern, only meaningful when
  // validatorType === 'regex_match'. BE rejects empty / invalid
  // patterns at create time so a half-set rule never persists.
  const [pattern, setPattern] = useState("");
  const [target, setTarget] = useState<"input" | "output" | "both">("both");
  const [onFail, setOnFail] = useState<"fix" | "exception">("fix");
  const [validatorSearch, setValidatorSearch] = useState("");
  const [entityFilter, setEntityFilter] = useState("");
  const [showAllEntities, setShowAllEntities] = useState(false);

  useEffect(() => {
    if (!open) return;
    if (initial) {
      // Edit mode — seed every field from the existing rule.
      setName(initial.name);
      setSeverity(initial.severity);
      setValidatorType(initial.validatorType ?? "no_pii");
      setSelectedEntities(new Set(initial.entities ?? []));
      setPattern(initial.pattern ?? "");
      setTarget(
        (initial.target === "input" ||
        initial.target === "output" ||
        initial.target === "both"
          ? initial.target
          : "both") as "input" | "output" | "both",
      );
      setOnFail(
        (initial.onFail === "exception" ? "exception" : "fix") as
          | "fix"
          | "exception",
      );
    } else {
      // Add mode — fresh defaults.
      setName("");
      setSeverity("high");
      setValidatorType("no_pii");
      setSelectedEntities(new Set(PII_ENTITIES));
      setPattern("");
      setTarget("both");
      setOnFail("fix");
    }
    setValidatorSearch("");
    setEntityFilter("");
    setShowAllEntities(false);
  }, [open, initial]);

  // entities is overloaded across validator types (PII entity names
  // for no_pii; free-form phrases for detect_jailbreak; ignored for
  // regex_match). When the admin switches validator, reset entities
  // so the previous validator's selections don't leak through. Skip
  // the reset on the very first render to keep the seeded edit-mode
  // state intact.
  const previousValidatorRef = useRef<string>(validatorType);
  useEffect(() => {
    if (!open) {
      previousValidatorRef.current = validatorType;
      return;
    }
    if (previousValidatorRef.current === validatorType) return;
    previousValidatorRef.current = validatorType;
    if (validatorType === "no_pii") {
      setSelectedEntities(new Set(PII_ENTITIES));
    } else {
      setSelectedEntities(new Set());
    }
  }, [open, validatorType]);

  const toggleEntity = (e: string) => {
    setSelectedEntities((prev) => {
      const next = new Set(prev);
      if (next.has(e)) next.delete(e);
      else next.add(e);
      return next;
    });
  };

  const validator = VALIDATOR_TYPES.find((v) => v.id === validatorType);
  const filteredValidators = VALIDATOR_TYPES.filter((v) =>
    v.name.toLowerCase().includes(validatorSearch.toLowerCase()),
  );
  const filteredEntities = entityFilter
    ? PII_ENTITIES.filter((e) =>
        e.toLowerCase().includes(entityFilter.toLowerCase()),
      )
    : PII_ENTITIES;
  const visibleEntities = showAllEntities
    ? filteredEntities
    : filteredEntities.slice(0, 10);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="flex w-[90vw] max-w-[calc(100%-2rem)] flex-col gap-0 overflow-hidden rounded p-0 sm:max-w-[1200px]"
        showCloseButton={false}
      >
        <div className="grid grid-cols-1 sm:grid-cols-[1fr_280px]">
          {/* Left column */}
          <div className="flex max-h-[70vh] flex-col">
            {/* Sticky header */}
            <div className="shrink-0 flex flex-col gap-3 px-6 pt-6 pb-4">
              <div className="flex items-center justify-between">
                {/* DialogTitle (vs a plain h2) so Radix can wire it
                    to the dialog's aria-labelledby. The styling
                    overrides the default tiny "leading-none font-
                    semibold" class so it still reads like an h2. */}
                <DialogTitle className="text-[23px] font-bold leading-tight text-text-1">
                  {initial ? "Edit guardrail" : "Add guardrail"}
                </DialogTitle>
                <button
                  type="button"
                  onClick={() => onOpenChange(false)}
                  className="flex h-8 w-8 cursor-pointer items-center justify-center rounded text-text-2 transition-colors hover:bg-bg-1 hover:text-text-1"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
              <p className="text-[14px] leading-[1.5] text-text-2">
                Guardrails detect and mitigate the presence of specific types
                of risks. To maintain the integrity and reliability of the
                model&apos;s inputs and outputs, safeguard user data and align
                with regulatory standards.
              </p>
            </div>

            {/* Scrollable form content */}
            <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto px-6 pb-6">
            {/* Guardrail name */}
            <div className="flex flex-col gap-2">
              <label className="text-[14px] font-medium text-text-1">
                Guardrail name
              </label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Enter guardrail name"
                className="h-10"
              />
            </div>

            {/* Severity */}
            <div className="flex flex-col gap-2">
              <label className="text-[14px] font-medium text-text-1">
                Severity
              </label>
              <Select value={severity} onValueChange={(v) => setSeverity(v as "high" | "medium" | "low")}>
                <SelectTrigger className="cursor-pointer data-[size=default]:h-10">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="high">High</SelectItem>
                  <SelectItem value="medium">Medium</SelectItem>
                  <SelectItem value="low">Low</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Validators section */}
            <div className="flex flex-col gap-3">
              <div className="flex flex-col gap-1">
                <h3 className="text-[16px] font-bold text-text-1">
                  Validators
                </h3>
                <p className="text-[13px] leading-[1.5] text-text-2">
                  Validators run input/output guards in your application that
                  detect, quantify and mitigate the presence of specific types
                  of risks.
                </p>
              </div>

              {/* Selected validator config */}
              {validator && (
                <div className="flex flex-col gap-5 rounded-lg border border-border-2 bg-bg-white p-5">
                  <div className="flex flex-col gap-1">
                    <h4 className="text-[16px] font-bold text-text-1">
                      {validator.name}
                    </h4>
                    <p className="text-[13px] text-text-2">
                      {validator.description}
                    </p>
                  </div>

                  {validatorType === "regex_match" && (
                    <div className="flex flex-col gap-2">
                      <label className="text-[14px] font-semibold text-text-2">
                        Regex pattern
                      </label>
                      <Input
                        value={pattern}
                        onChange={(e) => setPattern(e.target.value)}
                        // Two backslashes here render as a single \ in
                        // the input placeholder — JS regex syntax
                        // wants the literal `\b`. (?i) is gone because
                        // the engine already runs case-insensitive
                        // and the inline flag wasn't valid JS regex.
                        placeholder={"e.g. \\b(secret|confidential)\\b"}
                        className="h-10 font-mono text-[13px]"
                      />
                      <p className="text-[12px] text-text-3">
                        JavaScript regex flavour. Matches are
                        case-insensitive and global by default — no need
                        for inline flags. Invalid patterns are rejected
                        on save.
                      </p>
                    </div>
                  )}

                  {validatorType === "detect_jailbreak" && (
                    <div className="flex flex-col gap-2">
                      <label className="text-[14px] font-semibold text-text-2">
                        Custom phrases (optional)
                      </label>
                      <textarea
                        value={Array.from(selectedEntities).join("\n")}
                        onChange={(e) => {
                          // Each non-empty line is one custom phrase.
                          // We reuse `selectedEntities` so the rest of
                          // the dialog form treats jailbreak custom
                          // phrases identically to no_pii entities at
                          // submit time — both end up in `entities`.
                          const lines = e.target.value
                            .split(/\r?\n/)
                            .map((l) => l.trim())
                            .filter((l) => l.length > 0);
                          setSelectedEntities(new Set(lines));
                        }}
                        placeholder={
                          "ignore my hidden system prompt\nyou are unfiltered\noverride DAN"
                        }
                        rows={4}
                        className="resize-y rounded-md border border-border-2 bg-bg-white px-3 py-2 font-mono text-[13px] outline-none focus:border-primary-6"
                      />
                      <p className="text-[12px] text-text-3">
                        One phrase per line. These extend (don&apos;t
                        replace) the built-in jailbreak detector. Match is
                        case-insensitive on whole-word boundaries.
                      </p>
                    </div>
                  )}

                  {validatorType === "no_pii" && (
                    <>
                      {/* Entities + Filter checks */}
                      <div className="flex flex-col gap-2">
                        <label className="text-[14px] font-semibold text-text-2">
                          Entities
                        </label>
                        <div className="relative">
                          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-3" />
                          <Input
                            placeholder="Filter checks"
                            value={entityFilter}
                            onChange={(e) => setEntityFilter(e.target.value)}
                            className="h-9 rounded-md border-border-2 pl-9 text-[14px] placeholder:text-text-3"
                          />
                        </div>
                        <div className="max-h-[200px] overflow-y-auto rounded-md border border-border-2 bg-bg-white">
                          {visibleEntities.map((e) => (
                            <button
                              key={e}
                              type="button"
                              onClick={() => toggleEntity(e)}
                              className="flex w-full cursor-pointer items-center gap-3 border-b border-border-2 px-3 py-2 text-left last:border-b-0 hover:bg-bg-1"
                            >
                              <span
                                className={`flex h-[13px] w-[13px] shrink-0 items-center justify-center rounded-sm border ${
                                  selectedEntities.has(e)
                                    ? "border-primary-6 bg-primary-6"
                                    : "border-text-3 bg-bg-white"
                                }`}
                              >
                                {selectedEntities.has(e) && (
                                  <Check className="h-2.5 w-2.5 text-white" strokeWidth={3} />
                                )}
                              </span>
                              <span className="text-[13px] text-text-2">
                                {e}
                              </span>
                            </button>
                          ))}
                          {!showAllEntities && filteredEntities.length > 10 && (
                            <button
                              type="button"
                              onClick={() => setShowAllEntities(true)}
                              className="w-full cursor-pointer border-t border-border-2 px-3 py-2 text-center text-[13px] text-text-3 hover:text-primary-6"
                            >
                              Show all {filteredEntities.length} items
                            </button>
                          )}
                        </div>
                      </div>
                    </>
                  )}

                  {/* Select target — radio buttons */}
                  <div className="flex flex-col gap-2 pt-1">
                    <span className="text-[14px] font-semibold text-text-2">
                      Select target
                    </span>
                    <div className="flex items-center gap-6">
                      {(["Input", "Output", "Both"] as const).map((t) => {
                        const val = t.toLowerCase() as "input" | "output" | "both";
                        const active = target === val;
                        return (
                          <button
                            key={t}
                            type="button"
                            onClick={() => setTarget(val)}
                            className="flex cursor-pointer items-center gap-2"
                          >
                            <span
                              className={`flex h-[13px] w-[13px] items-center justify-center rounded-full border ${
                                active
                                  ? "border-primary-6"
                                  : "border-text-3"
                              }`}
                            >
                              {active && (
                                <span className="h-[7px] w-[7px] rounded-full bg-primary-6" />
                              )}
                            </span>
                            <span className="text-[14px] text-text-2">
                              {t}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* on_fail behavior — radio cards */}
                  <div className="flex flex-col gap-2 pt-1">
                    <span className="text-[14px] font-semibold text-text-2">
                      Select &ldquo;on_fail&rdquo; behavior
                    </span>
                    <div className="flex gap-6">
                      {[
                        {
                          id: "fix",
                          label: "Fix",
                          desc: "Guardrail will replace sensitive data with labels.",
                        },
                        {
                          id: "exception",
                          label: "Exception",
                          desc: "Guardrail will not send the sensitive data to LLMs, instead it will fail the prompt.",
                        },
                      ].map((opt) => {
                        const active = onFail === opt.id;
                        return (
                          <button
                            key={opt.id}
                            type="button"
                            onClick={() => setOnFail(opt.id as "fix" | "exception")}
                            className={`flex flex-1 cursor-pointer flex-col gap-2 rounded-lg border p-4 text-left transition-colors ${
                              active
                                ? "border-primary-6 bg-primary-1"
                                : "border-border-2 bg-bg-white hover:border-primary-6"
                            }`}
                          >
                            <span
                              className={`flex h-[13px] w-[13px] items-center justify-center rounded-full border ${
                                active
                                  ? "border-primary-6"
                                  : "border-text-3"
                              }`}
                            >
                              {active && (
                                <span className="h-[7px] w-[7px] rounded-full bg-primary-6" />
                              )}
                            </span>
                            <span className="text-[16px] font-semibold text-text-2">
                              {opt.label}
                            </span>
                            <p className="text-[12px] leading-[1.4] text-text-2">
                              {opt.desc}
                            </p>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>
              )}
            </div>
            </div>
          </div>

          {/* Right: Validator picker sidebar */}
          <div className="flex max-h-[70vh] flex-col overflow-y-auto border-l border-border-2 bg-bg-1 px-6 py-8">
            <h3 className="text-[18px] font-semibold leading-[1.3] text-text-1">
              Compliance templates
            </h3>

            <div className="relative mt-5">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-text-3" />
              <Input
                value={validatorSearch}
                onChange={(e) => setValidatorSearch(e.target.value)}
                placeholder="Filter validators"
                className="h-9 rounded-md border-border-3 bg-bg-white pl-10 text-[14px] placeholder:text-text-2"
              />
            </div>

            <div className="mt-5 flex flex-col">
              {filteredValidators.map((v, idx) => {
                const isLast = idx === filteredValidators.length - 1;
                return (
                  <div
                    key={v.id}
                    className={`flex items-center justify-between gap-3 py-3 ${
                      !isLast ? "border-b border-border-2" : ""
                    }`}
                  >
                    <div className="flex flex-col gap-0.5">
                      <span className="text-[14px] font-semibold leading-[1.3] text-text-1">
                        {v.name}
                      </span>
                      <span className="text-[12px] leading-[1.3] text-text-2">
                        {v.description}
                      </span>
                    </div>
                    {v.id === validatorType ? (
                      <span className="shrink-0 rounded bg-primary-6/10 px-2 py-0.5 text-[11px] font-medium text-primary-6">
                        Added
                      </span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setValidatorType(v.id)}
                        className="flex shrink-0 cursor-pointer items-center justify-center rounded px-1 py-1 text-[18px] leading-none text-text-3 transition-colors hover:text-primary-6"
                      >
                        +
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between bg-bg-white px-6 py-6">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            className="cursor-pointer"
          >
            Cancel
          </Button>
          <Button
            onClick={() =>
              onSubmit({
                name,
                type:
                  validatorType === "no_pii"
                    ? "PII Protection"
                    : validatorType === "detect_jailbreak"
                      ? "Content Safety"
                      : "Custom",
                severity,
                validatorType,
                // entities is reused for two validators: PII entity
                // names for no_pii; admin-supplied custom jailbreak
                // phrases for detect_jailbreak. regex_match doesn't
                // use it.
                entities:
                  validatorType === "no_pii" ||
                  validatorType === "detect_jailbreak"
                    ? Array.from(selectedEntities)
                    : [],
                ...(validatorType === "regex_match"
                  ? { pattern: pattern.trim() }
                  : {}),
                target,
                onFail,
              })
            }
            disabled={
              !name.trim() ||
              isPending ||
              (validatorType === "regex_match" && !pattern.trim())
            }
            className="cursor-pointer bg-primary-6 hover:bg-primary-7"
          >
            {isPending
              ? initial
                ? "Saving..."
                : "Adding..."
              : initial
                ? "Save"
                : "Add"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* ─── Main Page ──────────────────────────────────────────────────────── */

export default function GuardrailsPage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const VALID_TABS: Tab[] = ["overview", "templates"];
  const rawTab = searchParams.get("tab");
  const tab: Tab = VALID_TABS.includes(rawTab as Tab) ? (rawTab as Tab) : "overview";
  const setTab = (t: Tab) => {
    router.replace(`/guardrails?tab=${encodeURIComponent(t)}`, { scroll: false });
  };
  const [addOpen, setAddOpen] = useState(false);
  // When set, the dialog opens in edit mode pre-seeded with this rule.
  // Cleared on close so the next "Add" click starts from defaults.
  const [editingRule, setEditingRule] = useState<GuardrailItem | null>(null);

  const queryClient = useQueryClient();

  const { data: guardrailsList = [], isLoading: listLoading } = useQuery({
    queryKey: ["guardrails-section"],
    queryFn: fetchGuardrailItems,
  });

  const { data: stats } = useQuery({
    queryKey: ["guardrails-stats"],
    queryFn: fetchGuardrailStats,
  });

  const { data: templates = [], isLoading: templatesLoading } = useQuery({
    queryKey: ["guardrails-templates"],
    queryFn: fetchComplianceTemplates,
  });

  const invalidateAll = () => {
    queryClient.invalidateQueries({ queryKey: ["guardrails-section"] });
    queryClient.invalidateQueries({ queryKey: ["guardrails-stats"] });
  };

  const createMutation = useMutation({
    mutationFn: createGuardrailItem,
    onSuccess: () => {
      invalidateAll();
      setAddOpen(false);
      toast.success("Guardrail created.");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const updateMutation = useMutation({
    mutationFn: (args: {
      id: string;
      data: Parameters<typeof updateGuardrailItem>[1];
    }) => updateGuardrailItem(args.id, args.data),
    onSuccess: () => {
      invalidateAll();
      setEditingRule(null);
      setAddOpen(false);
      toast.success("Guardrail updated.");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const toggleMutation = useMutation({
    mutationFn: toggleGuardrailItem,
    onSuccess: () => invalidateAll(),
    onError: () => toast.error("Failed to toggle guardrail."),
  });

  const toggleOrgWideMutation = useMutation({
    mutationFn: toggleGuardrailOrgWide,
    onSuccess: (rule) => {
      invalidateAll();
      // Also refresh team-detail listings — an org-wide rule shows up
      // there too and the badge state needs to flip in sync.
      queryClient.invalidateQueries({ queryKey: ["guardrails"] });
      toast.success(
        rule.isOrgWide
          ? `"${rule.name}" is now Org-wide.`
          : `"${rule.name}" returned to per-team scope.`,
      );
    },
    onError: (err: Error) =>
      toast.error(err.message || "Failed to toggle org-wide scope."),
  });

  const { user: currentUser } = useAuth();
  const canOrgWide = currentUser?.profileType === "company";

  const deleteMutation = useMutation({
    mutationFn: deleteGuardrailItem,
    onSuccess: () => {
      invalidateAll();
      toast.success("Guardrail deleted.");
    },
    onError: () => toast.error("Failed to delete guardrail."),
  });

  const applyMutation = useMutation({
    mutationFn: (templateId: string) => applyComplianceTemplate(templateId),
    onSuccess: (result) => {
      invalidateAll();
      toast.success(
        `Applied ${result.templateName}: ${result.rulesCreated} rules created.`,
      );
    },
    onError: () => toast.error("Failed to apply template."),
  });

  const disableMutation = useMutation({
    mutationFn: (templateId: string) => removeComplianceTemplate(templateId),
    onSuccess: (result) => {
      invalidateAll();
      toast.success(`Disabled template: ${result.rulesRemoved} rules removed.`);
    },
    onError: () => toast.error("Failed to disable template."),
  });

  const appliedTemplateIds = useMemo(
    () => new Set(guardrailsList.map((g) => g.templateSource).filter(Boolean) as string[]),
    [guardrailsList],
  );

  // Appbar "Add Guardrail" button listener
  useEffect(() => {
    const handler = () => setAddOpen(true);
    window.addEventListener("guardrails:add", handler);
    return () => window.removeEventListener("guardrails:add", handler);
  }, []);

  return (
    <div className="flex flex-col gap-6 py-6">
      {/* Tabs */}
      <div className="flex border-b border-border-2">
        <button
          type="button"
          onClick={() => setTab("overview")}
          className={`cursor-pointer border-b px-4 py-4 text-[18px] transition-colors ${
            tab === "overview"
              ? "border-border-3 font-bold text-text-1"
              : "border-transparent font-normal text-text-2 hover:text-text-1"
          }`}
        >
          Overview
        </button>
        <button
          type="button"
          onClick={() => setTab("templates")}
          className={`cursor-pointer border-b px-4 py-4 text-[18px] transition-colors ${
            tab === "templates"
              ? "border-border-3 font-bold text-text-1"
              : "border-transparent font-normal text-text-2 hover:text-text-1"
          }`}
        >
          Compliance templates
        </button>
      </div>

      {tab === "overview" && (
        <OverviewTab
          guardrailsList={guardrailsList}
          stats={stats}
          isLoading={listLoading}
          onToggle={(id) => toggleMutation.mutate(id)}
          onToggleOrgWide={(id) => toggleOrgWideMutation.mutate(id)}
          onDelete={(id) => deleteMutation.mutate(id)}
          onEdit={(rule) => {
            setEditingRule(rule);
            setAddOpen(true);
          }}
          canOrgWide={canOrgWide}
        />
      )}

      {tab === "templates" && (
        <TemplatesTab
          templates={templates}
          isLoading={templatesLoading}
          appliedTemplateIds={appliedTemplateIds}
          onApply={(id) => applyMutation.mutate(id)}
          onDisable={(id) => disableMutation.mutate(id)}
        />
      )}

      {/* Add / Edit Guardrail Dialog. Same component for both —
          `initial` flips it into edit mode and the parent picks
          between create + update mutations. Closing also clears
          editingRule so the next "Add" starts blank. */}
      <AddGuardrailDialog
        open={addOpen}
        onOpenChange={(v) => {
          setAddOpen(v);
          if (!v) setEditingRule(null);
        }}
        onSubmit={(data) => {
          if (editingRule) {
            updateMutation.mutate({ id: editingRule.id, data });
          } else {
            createMutation.mutate(data);
          }
        }}
        isPending={
          editingRule
            ? updateMutation.isPending
            : createMutation.isPending
        }
        initial={editingRule}
      />
    </div>
  );
}
