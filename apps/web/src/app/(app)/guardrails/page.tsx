"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Check,
  ChevronLeft,
  ChevronRight,
  Eye,
  Loader2,
  Plus,
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
  toggleGuardrailItem,
  deleteGuardrailItem,
  applyComplianceTemplate,
  fetchTeams,
  type GuardrailItem,
  type GuardrailStats,
  type ComplianceTemplateItem,
} from "@/lib/api";

type Tab = "overview" | "templates";
type Severity = "high" | "medium" | "low";

const SEVERITY_STYLES: Record<Severity, string> = {
  high: "bg-[#FFECE8] text-danger-6",
  medium: "bg-[#FFF3E6] text-[#FF7D00]",
  low: "bg-[#E8FFEA] text-[#009A29]",
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
    <div className="flex flex-1 gap-4 rounded-[20px] bg-bg-white p-6">
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
  onDelete,
}: {
  guardrailsList: GuardrailItem[];
  stats: GuardrailStats | undefined;
  isLoading: boolean;
  onToggle: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [severity, setSeverity] = useState<string>("all");
  const [page, setPage] = useState(1);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const deleteName =
    guardrailsList.find((g) => g.id === deleteId)?.name ?? "";

  const filtered = useMemo(() => {
    let list = guardrailsList;
    if (severity !== "all") {
      list = list.filter((g) => g.severity === severity);
    }
    const q = query.trim().toLowerCase();
    if (q) {
      list = list.filter(
        (g) =>
          g.name.toLowerCase().includes(q) ||
          g.type.toLowerCase().includes(q),
      );
    }
    return list;
  }, [guardrailsList, query, severity]);

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
          iconBg="bg-[#EBF8FF] text-primary-6"
        />
        <StatCard
          label="Total Triggers"
          value={(stats?.totalTriggers ?? 0).toLocaleString()}
          icon={Zap}
          iconBg="bg-[#FFF3E6] text-[#FF7D00]"
        />
        <StatCard
          label="Critical Rules"
          value={String(stats?.criticalRules ?? 0)}
          icon={AlertTriangle}
          iconBg="bg-[#FFECE8] text-danger-6"
        />
        <StatCard
          label="Coverage"
          value={`${stats?.coverage ?? 0}%`}
          icon={Eye}
          iconBg="bg-[#E8FFEA] text-[#009A29]"
        />
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-4">
        <h3 className="text-[18px] font-bold text-text-1">All Guardrails</h3>
        <div className="relative flex-1 sm:max-w-xs">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-3" />
          <Input
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setPage(1);
            }}
            placeholder="Search guardrails..."
            className="h-9 pl-9 placeholder:text-text-3"
          />
        </div>
        <Select
          value={severity}
          onValueChange={(v) => {
            setSeverity(v);
            setPage(1);
          }}
        >
          <SelectTrigger className="w-[160px] cursor-pointer data-[size=default]:h-9">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Severities</SelectItem>
            <SelectItem value="high">High</SelectItem>
            <SelectItem value="medium">Medium</SelectItem>
            <SelectItem value="low">Low</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Table */}
      <div className="overflow-hidden rounded-[20px] bg-bg-white">
        <table className="w-full text-left text-[13px]">
          <thead>
            <tr className="border-b border-border-2 text-[12px] font-semibold uppercase tracking-wide text-text-3">
              <th className="px-6 py-3">Name</th>
              <th className="px-6 py-3">Type</th>
              <th className="px-6 py-3">Severity</th>
              <th className="px-6 py-3">Triggers</th>
              <th className="px-6 py-3">Status</th>
              <th className="px-6 py-3">Actions</th>
            </tr>
          </thead>
          <tbody>
            {paginated.map((g) => (
              <tr
                key={g.id}
                className="border-b border-border-2 last:border-b-0 transition-colors hover:bg-bg-1"
              >
                <td className="px-6 py-4">
                  <div className="flex flex-col">
                    <span className="font-medium text-text-1">{g.name}</span>
                    {g.teamName && (
                      <span className="text-[11px] text-text-3">
                        {g.teamName}
                      </span>
                    )}
                  </div>
                </td>
                <td className="px-6 py-4 text-text-2">{g.type}</td>
                <td className="px-6 py-4">
                  <span
                    className={`inline-flex rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${SEVERITY_STYLES[g.severity]}`}
                  >
                    {g.severity}
                  </span>
                </td>
                <td className="px-6 py-4 text-text-2">
                  {g.triggers.toLocaleString()}
                </td>
                <td className="px-6 py-4">
                  <button
                    type="button"
                    role="switch"
                    aria-checked={g.isActive}
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
                <td className="px-6 py-4">
                  <button
                    type="button"
                    onClick={() => setDeleteId(g.id)}
                    className="flex h-7 w-7 cursor-pointer items-center justify-center rounded text-text-3 transition-colors hover:bg-[#FFECE8] hover:text-danger-6"
                    title="Delete"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </td>
              </tr>
            ))}
            {paginated.length === 0 && (
              <tr>
                <td
                  colSpan={6}
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
  onApply,
}: {
  templates: ComplianceTemplateItem[];
  isLoading: boolean;
  onApply: (templateId: string) => void;
}) {
  if (isLoading) {
    return (
      <div className="flex flex-1 items-center justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-text-3" />
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      {templates.map((t) => (
        <div
          key={t.id}
          className="flex flex-col gap-4 rounded-[20px] bg-bg-white p-6"
        >
          <div className="flex items-start justify-between">
            <div className="flex flex-col gap-1">
              <h3 className="text-[16px] font-bold text-text-1">{t.name}</h3>
              <span className="text-[12px] font-medium text-primary-6">
                {t.ruleCount} rules
              </span>
            </div>
            <Shield className="h-6 w-6 text-primary-6" />
          </div>
          <p className="text-[13px] text-text-2">{t.description}</p>
          <ul className="flex flex-col gap-1.5">
            {t.features.map((f) => (
              <li
                key={f}
                className="flex items-center gap-2 text-[12px] text-text-1"
              >
                <Check className="h-3 w-3 shrink-0 text-[#009A29]" />
                {f}
              </li>
            ))}
          </ul>
          <Button
            onClick={() => onApply(t.id)}
            variant="outline"
            className="mt-auto cursor-pointer"
          >
            Apply
          </Button>
        </div>
      ))}
    </div>
  );
}

/* ─── Add Guardrail Dialog ───────────────────────────────────────────── */

function AddGuardrailDialog({
  open,
  onOpenChange,
  teams,
  onSubmit,
  isPending,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  teams: { id: string; name: string }[];
  onSubmit: (data: {
    teamId: string;
    name: string;
    type: string;
    severity: string;
    validatorType: string;
    entities: string[];
    target: string;
    onFail: string;
  }) => void;
  isPending: boolean;
}) {
  const [name, setName] = useState("");
  const [teamId, setTeamId] = useState(teams[0]?.id ?? "");
  const [validatorType, setValidatorType] = useState("no_pii");
  const [selectedEntities, setSelectedEntities] = useState<Set<string>>(
    new Set(PII_ENTITIES),
  );
  const [target, setTarget] = useState<string>("both");
  const [onFail, setOnFail] = useState<string>("fix");
  const [validatorSearch, setValidatorSearch] = useState("");
  const [showAllEntities, setShowAllEntities] = useState(false);

  useEffect(() => {
    if (open) {
      setName("");
      setTeamId(teams[0]?.id ?? "");
      setValidatorType("no_pii");
      setSelectedEntities(new Set(PII_ENTITIES));
      setTarget("both");
      setOnFail("fix");
      setValidatorSearch("");
      setShowAllEntities(false);
    }
  }, [open, teams]);

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
  const visibleEntities = showAllEntities
    ? PII_ENTITIES
    : PII_ENTITIES.slice(0, 10);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="flex w-[90vw] max-w-[calc(100%-2rem)] flex-col gap-0 overflow-hidden rounded p-0 sm:max-w-[1200px]"
        showCloseButton={false}
      >
        <div className="grid grid-cols-1 sm:grid-cols-[1fr_280px]">
          {/* Left: Header + Form */}
          <div className="flex max-h-[70vh] flex-col gap-6 overflow-y-auto p-6">
            {/* Header */}
            <div className="flex flex-col gap-3">
              <div className="flex items-center justify-between">
                <h2 className="text-[23px] font-bold text-text-1">
                  Add guardrail
                </h2>
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

            {/* Team */}
            <div className="flex flex-col gap-2">
              <label className="text-[14px] font-medium text-text-1">
                Team
              </label>
              <Select value={teamId} onValueChange={setTeamId}>
                <SelectTrigger className="cursor-pointer data-[size=default]:h-10">
                  <SelectValue placeholder="Select team" />
                </SelectTrigger>
                <SelectContent>
                  {teams.map((t) => (
                    <SelectItem key={t.id} value={t.id}>
                      {t.name}
                    </SelectItem>
                  ))}
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

                  {validatorType === "no_pii" && (
                    <>
                      {/* Name + Entities fields */}
                      <div className="grid grid-cols-2 gap-4">
                        <div className="flex flex-col gap-1.5">
                          <label className="text-[13px] font-medium text-text-1">
                            Name
                          </label>
                          <Input
                            value={validator.name}
                            disabled
                            className="h-9 text-[13px]"
                          />
                        </div>
                        <div className="flex flex-col gap-1.5">
                          <label className="text-[13px] font-medium text-text-1">
                            Entities
                          </label>
                          <Input
                            value={`${selectedEntities.size} selected`}
                            disabled
                            className="h-9 text-[13px]"
                          />
                        </div>
                      </div>

                      {/* Filter checks */}
                      <div className="flex flex-col gap-3">
                        <span className="text-[14px] font-medium text-text-1">
                          Filter checks
                        </span>
                        <div className="flex flex-wrap gap-2">
                          {visibleEntities.map((e) => (
                            <button
                              key={e}
                              type="button"
                              onClick={() => toggleEntity(e)}
                              className={`cursor-pointer rounded px-3 py-1.5 text-[12px] font-medium transition-colors ${
                                selectedEntities.has(e)
                                  ? "bg-primary-6 text-white"
                                  : "border border-border-2 bg-bg-white text-text-2 hover:border-primary-6"
                              }`}
                            >
                              {e}
                            </button>
                          ))}
                        </div>
                        {!showAllEntities && PII_ENTITIES.length > 10 && (
                          <button
                            type="button"
                            onClick={() => setShowAllEntities(true)}
                            className="cursor-pointer self-start text-[13px] font-medium text-primary-6 hover:text-primary-7"
                          >
                            Show all {PII_ENTITIES.length} items
                          </button>
                        )}
                      </div>
                    </>
                  )}

                  {/* Select target */}
                  <div className="flex flex-col gap-3">
                    <span className="text-[14px] font-medium text-text-1">
                      Select target
                    </span>
                    <div className="flex gap-2">
                      {(["Input", "Output", "Both"] as const).map((t) => {
                        const val = t.toLowerCase();
                        return (
                          <button
                            key={t}
                            type="button"
                            onClick={() => setTarget(val)}
                            className={`cursor-pointer rounded-lg px-4 py-2 text-[13px] font-medium transition-colors ${
                              target === val
                                ? "bg-primary-6 text-white"
                                : "border border-border-2 bg-bg-white text-text-1 hover:border-primary-6"
                            }`}
                          >
                            {t}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* on_fail behavior */}
                  <div className="flex flex-col gap-3">
                    <span className="text-[14px] font-medium text-text-1">
                      Select &ldquo;on_fail&rdquo; behavior
                    </span>
                    <div className="flex flex-col gap-2">
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
                      ].map((opt) => (
                        <button
                          key={opt.id}
                          type="button"
                          onClick={() => setOnFail(opt.id)}
                          className={`flex cursor-pointer flex-col gap-1 rounded-lg border p-4 text-left transition-colors ${
                            onFail === opt.id
                              ? "border-primary-6 bg-[#EBF8FF]"
                              : "border-border-2 bg-bg-white hover:border-primary-6"
                          }`}
                        >
                          <span className="text-[14px] font-semibold text-text-1">
                            {opt.label}
                          </span>
                          <p className="text-[12px] leading-[1.5] text-text-2">
                            {opt.desc}
                          </p>
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              )}
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
                placeholder=" Filter validators"
                className="h-9 rounded-md border-[#C9CDD4] bg-bg-white pl-10 text-[14px] placeholder:text-text-2"
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
                teamId,
                name,
                type:
                  validatorType === "no_pii"
                    ? "PII Protection"
                    : validatorType === "detect_jailbreak"
                      ? "Content Safety"
                      : "Custom",
                severity: "high",
                validatorType,
                entities: Array.from(selectedEntities),
                target,
                onFail,
              })
            }
            disabled={!name.trim() || !teamId || isPending}
            className="cursor-pointer bg-primary-6 hover:bg-primary-7"
          >
            {isPending ? "Adding..." : "Add"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* ─── Main Page ──────────────────────────────────────────────────────── */

export default function GuardrailsPage() {
  const [tab, setTab] = useState<Tab>("overview");
  const [addOpen, setAddOpen] = useState(false);
  const [applyTeamDialogOpen, setApplyTeamDialogOpen] = useState(false);
  const [pendingTemplateId, setPendingTemplateId] = useState<string | null>(
    null,
  );
  const [applyTeamId, setApplyTeamId] = useState("");

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

  const { data: userTeams = [] } = useQuery({
    queryKey: ["teams"],
    queryFn: fetchTeams,
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

  const toggleMutation = useMutation({
    mutationFn: toggleGuardrailItem,
    onSuccess: () => invalidateAll(),
    onError: () => toast.error("Failed to toggle guardrail."),
  });

  const deleteMutation = useMutation({
    mutationFn: deleteGuardrailItem,
    onSuccess: () => {
      invalidateAll();
      toast.success("Guardrail deleted.");
    },
    onError: () => toast.error("Failed to delete guardrail."),
  });

  const applyMutation = useMutation({
    mutationFn: ({
      templateId,
      teamId,
    }: {
      templateId: string;
      teamId: string;
    }) => applyComplianceTemplate(templateId, teamId),
    onSuccess: (result) => {
      invalidateAll();
      setApplyTeamDialogOpen(false);
      setPendingTemplateId(null);
      toast.success(
        `Applied ${result.templateName}: ${result.rulesCreated} rules created.`,
      );
    },
    onError: () => toast.error("Failed to apply template."),
  });

  const handleApplyTemplate = (templateId: string) => {
    if (userTeams.length === 1) {
      applyMutation.mutate({ templateId, teamId: userTeams[0].id });
    } else {
      setPendingTemplateId(templateId);
      setApplyTeamId(userTeams[0]?.id ?? "");
      setApplyTeamDialogOpen(true);
    }
  };

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
          className={`cursor-pointer border-b-2 px-4 py-3 text-[14px] font-medium transition-colors ${
            tab === "overview"
              ? "border-primary-6 text-text-1"
              : "border-transparent text-text-2 hover:text-text-1"
          }`}
        >
          Overview
        </button>
        <button
          type="button"
          onClick={() => setTab("templates")}
          className={`cursor-pointer border-b-2 px-4 py-3 text-[14px] font-medium transition-colors ${
            tab === "templates"
              ? "border-primary-6 text-text-1"
              : "border-transparent text-text-2 hover:text-text-1"
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
          onDelete={(id) => deleteMutation.mutate(id)}
        />
      )}

      {tab === "templates" && (
        <TemplatesTab
          templates={templates}
          isLoading={templatesLoading}
          onApply={handleApplyTemplate}
        />
      )}

      {/* Add Guardrail Dialog */}
      <AddGuardrailDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        teams={userTeams.map((t) => ({ id: t.id, name: t.name }))}
        onSubmit={(data) => createMutation.mutate(data)}
        isPending={createMutation.isPending}
      />

      {/* Apply Template — team picker (when user has multiple teams) */}
      <Dialog
        open={applyTeamDialogOpen}
        onOpenChange={(open) => !open && setApplyTeamDialogOpen(false)}
      >
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Select Team</DialogTitle>
            <DialogDescription>
              Choose which team to apply this compliance template to.
            </DialogDescription>
          </DialogHeader>
          <Select value={applyTeamId} onValueChange={setApplyTeamId}>
            <SelectTrigger className="cursor-pointer data-[size=default]:h-10">
              <SelectValue placeholder="Select team" />
            </SelectTrigger>
            <SelectContent>
              {userTeams.map((t) => (
                <SelectItem key={t.id} value={t.id}>
                  {t.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              onClick={() => setApplyTeamDialogOpen(false)}
              className="cursor-pointer"
            >
              Cancel
            </Button>
            <Button
              onClick={() => {
                if (pendingTemplateId && applyTeamId) {
                  applyMutation.mutate({
                    templateId: pendingTemplateId,
                    teamId: applyTeamId,
                  });
                }
              }}
              disabled={!applyTeamId || applyMutation.isPending}
              className="cursor-pointer bg-primary-6 hover:bg-primary-7"
            >
              {applyMutation.isPending ? "Applying..." : "Apply"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
