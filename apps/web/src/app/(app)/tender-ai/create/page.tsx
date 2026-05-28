"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  Calendar,
  Check,
  DollarSign,
  Eye,
  FileText,
  ListChecks,
  Loader2,
  Mail,
  Plus,
  Search,
  Sparkles,
  Upload,
  Users,
  X,
  type LucideIcon,
} from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { createTender, fetchOrgUsers } from "@/lib/api";
import { useLanguage } from "@/lib/i18n";
import type { TranslationKey } from "@/lib/translations/en";

const STEPS: { titleKey: TranslationKey; stepNum: number; icon: LucideIcon }[] = [
  { titleKey: "tenderCreate.step1", stepNum: 1, icon: FileText },
  { titleKey: "tenderCreate.step2", stepNum: 2, icon: ListChecks },
  { titleKey: "tenderCreate.step3", stepNum: 3, icon: Users },
  { titleKey: "tenderCreate.step4", stepNum: 4, icon: Upload },
  { titleKey: "tenderCreate.step5", stepNum: 5, icon: Eye },
];

const CATEGORIES = [
  "Cloud Services",
  "IT Infrastructure",
  "Cybersecurity",
  "AI & Machine Learning",
  "Data Analytics",
  "Software Development",
  "Consulting",
  "Managed Services",
  "Digital Transformation",
  "Other",
];

const SUFFIXES: Record<string, number> = { k: 1_000, m: 1_000_000, b: 1_000_000_000 };

function formatCurrency(raw: string): string {
  const cleaned = raw.replace(/[^0-9.kmb]/gi, "");
  if (!cleaned) return "";
  if (/[kmb]/i.test(cleaned)) return cleaned;
  const [whole, dec] = cleaned.split(".");
  const formatted = Number(whole || "0").toLocaleString("en-US");
  if (cleaned.includes(".")) {
    return `${formatted}.${(dec ?? "").slice(0, 2)}`;
  }
  return formatted;
}

function expandShorthand(value: string): string {
  const match = value.match(/^(\d+(?:\.\d+)?)\s*([kmb])$/i);
  if (!match) return value;
  const num = parseFloat(match[1]);
  const multiplier = SUFFIXES[match[2].toLowerCase()] ?? 1;
  return Math.round(num * multiplier).toLocaleString("en-US");
}

type Priority = "High" | "Medium" | "Low";

interface Requirement {
  id: string;
  text: string;
  priority: Priority;
}


interface BasicInfo {
  name: string;
  rfpNumber: string;
  category: string;
  client: string;
  deadline: string;
  value: string;
  description: string;
}

/* ─── Steppers ───────────────────────────────────────────────────────── */

function DesktopStepper({ active }: { active: number }) {
  const { t } = useLanguage();
  return (
    <nav className="hidden items-center px-6 py-4 lg:flex">
      {STEPS.map((s, i) => {
        const done = i < active;
        const current = i === active;
        const Icon = s.icon;
        return (
          <div key={i} className="flex flex-1 items-center">
            <div className="flex items-center gap-3">
              <span
                className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${
                  done
                    ? "bg-primary-6 text-white"
                    : current
                      ? "bg-primary-6 text-white"
                      : "border border-border-2 bg-bg-white text-text-3"
                }`}
              >
                {done ? <Check className="h-4 w-4" /> : <Icon className="h-4 w-4" />}
              </span>
              <div className="flex flex-col">
                <span
                  className={`text-[13px] font-medium ${
                    current || done ? "text-text-1" : "text-text-3"
                  }`}
                >
                  {t(s.titleKey)}
                </span>
                <span className="text-[11px] text-text-3">{t("tenderCreate.stepNof").replace("{n}", String(s.stepNum))}</span>
              </div>
            </div>
            {i < STEPS.length - 1 && (
              <span
                className={`mx-4 h-px flex-1 ${
                  done ? "bg-primary-6" : "bg-border-2"
                }`}
              />
            )}
          </div>
        );
      })}
    </nav>
  );
}

function MobileStepper({ active }: { active: number }) {
  const { t } = useLanguage();
  return (
    <nav className="flex items-center gap-0 border border-border-2 bg-bg-white px-4 py-3 lg:hidden">
      {STEPS.map((s, i) => {
        const done = i < active;
        const current = i === active;
        const Icon = s.icon;
        return (
          <div key={i} className="flex flex-1 items-center">
            <div className="flex flex-col items-center gap-1">
              <span
                className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full ${
                  done || current
                    ? "bg-primary-6 text-white"
                    : "border border-border-2 bg-bg-white text-text-3"
                }`}
              >
                {done ? <Check className="h-3 w-3" /> : <Icon className="h-3 w-3" />}
              </span>
              <span
                className={`text-center text-[9px] leading-tight ${
                  current ? "font-medium text-text-1" : "text-text-3"
                }`}
              >
                {t(s.titleKey)}
              </span>
            </div>
            {i < STEPS.length - 1 && (
              <span
                className={`mx-1 h-px flex-1 ${
                  done ? "bg-primary-6" : "bg-border-2"
                }`}
              />
            )}
          </div>
        );
      })}
    </nav>
  );
}

/* ─── Step 1: Basic Information ──────────────────────────────────────── */

function BasicInfoStep({
  data,
  onChange,
  touched,
}: {
  data: BasicInfo;
  onChange: (d: BasicInfo) => void;
  touched: boolean;
}) {
  const { t } = useLanguage();
  const update = (field: keyof BasicInfo, value: string) =>
    onChange({ ...data, [field]: value });

  const err = (field: keyof BasicInfo) =>
    touched && !data[field].trim();

  return (
    <div className="flex flex-col gap-8">
      <div className="text-center">
        <h2 className="text-[20px] sm:text-[26px] font-bold leading-[1.3] text-text-1">
          {t("tenderCreate.basicTitle")}
        </h2>
        <p className="mt-2 text-[14px] leading-[1.3] text-text-2">
          {t("tenderCreate.basicSubtitle")}
        </p>
      </div>

      {/* Essential Details */}
      <div className="flex flex-col gap-4">
        <div className="flex items-center gap-2">
          <span className="h-5 w-1 rounded-full bg-primary-6" />
          <span className="text-[18px] font-bold leading-[1.3] text-text-1">{t("tenderCreate.essentialDetails")}</span>
        </div>
        <div className="flex flex-col gap-[7px]">
          <label className="text-[13px] text-text-1">
            {t("tenderCreate.tenderName")} <span className="text-danger-6">*</span>
          </label>
          <Input
            value={data.name}
            onChange={(e) => update("name", e.target.value)}
            placeholder={t("tenderCreate.tenderNamePh")}
            className={`h-[52px] px-4 text-[16px] ${err("name") ? "border-danger-6" : ""}`}
          />
          {err("name") ? (
            <span className="text-[12px] text-danger-6">{t("tenderCreate.tenderNameErr")}</span>
          ) : (
            <span className="text-[13px] text-text-2">
              {t("tenderCreate.tenderNameExample")}
            </span>
          )}
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-[7px]">
            <label className="text-[13px] text-text-1">
              {t("tenderCreate.rfpNumber")} <span className="text-danger-6">*</span>
            </label>
            <Input
              value={data.rfpNumber}
              onChange={(e) => update("rfpNumber", e.target.value)}
              placeholder="TND-2026-006"
              className={`h-[52px] px-4 text-[16px] ${err("rfpNumber") ? "border-danger-6" : ""}`}
            />
            {err("rfpNumber") && (
              <span className="text-[12px] text-danger-6">{t("tenderCreate.rfpNumberErr")}</span>
            )}
          </div>
          <div className="flex flex-col gap-[7px]">
            <label className="text-[13px] text-text-1">
              {t("tenderCreate.category")} <span className="text-danger-6">*</span>
            </label>
            <Select
              value={data.category}
              onValueChange={(v) => update("category", v)}
            >
              <SelectTrigger className={`w-full cursor-pointer text-[16px] data-[size=default]:h-[52px] ${err("category") ? "border-danger-6" : ""}`}>
                <SelectValue placeholder={t("tenderCreate.selectCategory")} />
              </SelectTrigger>
              <SelectContent>
                {CATEGORIES.map((c) => (
                  <SelectItem key={c} value={c}>
                    {c}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {err("category") && (
              <span className="text-[12px] text-danger-6">{t("tenderCreate.categoryErr")}</span>
            )}
          </div>
        </div>
        <div className="flex flex-col gap-[7px]">
          <label className="text-[13px] text-text-1">
            {t("tenderCreate.clientName")} <span className="text-danger-6">*</span>
          </label>
          <Input
            value={data.client}
            onChange={(e) => update("client", e.target.value)}
            placeholder={t("tenderCreate.clientNamePh")}
            className={`h-[52px] px-4 text-[16px] ${err("client") ? "border-danger-6" : ""}`}
          />
          {err("client") && (
            <span className="text-[12px] text-danger-6">{t("tenderCreate.clientNameErr")}</span>
          )}
        </div>
      </div>

      {/* Timeline & Budget */}
      <div className="flex flex-col gap-4 border-t border-border-2 pt-4">
        <div className="flex items-center gap-2">
          <span className="h-5 w-1 rounded-full bg-primary-6" />
          <span className="text-[18px] font-bold leading-[1.3] text-text-1">{t("tenderCreate.timelineBudget")}</span>
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-[7px]">
            <label className="text-[13px] text-text-1">
              {t("tenderCreate.submissionDeadline")} <span className="text-danger-6">*</span>
            </label>
            <div
              className="relative cursor-pointer"
              onClick={() => {
                const input = document.getElementById("deadline-input") as HTMLInputElement | null;
                input?.showPicker();
              }}
            >
              <Calendar className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-text-3" />
              <Input
                id="deadline-input"
                type="date"
                value={data.deadline}
                onChange={(e) => update("deadline", e.target.value)}
                className={`pointer-events-none h-[52px] pl-11 text-[16px] ${err("deadline") ? "border-danger-6" : ""}`}
              />
            </div>
            {err("deadline") && (
              <span className="text-[12px] text-danger-6">{t("tenderCreate.deadlineErr")}</span>
            )}
          </div>
          <div className="flex flex-col gap-[7px]">
            <label className="text-[13px] text-text-1">
              {t("tenderCreate.contractValue")} <span className="text-danger-6">*</span>
            </label>
            <div className="relative">
              <DollarSign className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-text-3" />
              <Input
                value={data.value}
                onChange={(e) => update("value", formatCurrency(e.target.value))}
                onBlur={() => update("value", expandShorthand(data.value))}
                placeholder="2,400,000"
                className={`h-[52px] pl-11 text-[16px] ${err("value") ? "border-danger-6" : ""}`}
              />
            </div>
            {err("value") ? (
              <span className="text-[12px] text-danger-6">{t("tenderCreate.contractValueErr")}</span>
            ) : (
              <span className="text-[13px] text-text-2">
                {t("tenderCreate.contractValueHint")}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Description */}
      <div className="flex flex-col gap-4 border-t border-border-2 pt-4">
        <div className="flex items-center gap-2">
          <span className="h-5 w-1 rounded-full bg-primary-6" />
          <span className="text-[18px] font-bold leading-[1.3] text-text-1">{t("tenderCreate.projectDescription")}</span>
        </div>
        <div className="flex flex-col gap-[10px]">
          <label className="text-[13px] text-text-1">
            {t("tenderCreate.description")} <span className="text-danger-6">*</span>
          </label>
          <Textarea
            value={data.description}
            onChange={(e) => update("description", e.target.value)}
            placeholder={t("tenderCreate.descriptionPh")}
            className={`min-h-[140px] px-4 py-4 text-[16px] ${err("description") ? "border-danger-6" : ""}`}
          />
          <div className="flex items-center justify-between text-[13px] text-text-2">
            <span>
              {t("tenderCreate.descriptionHint")}
            </span>
            <span>{data.description.length} {t("tenderCreate.characters")}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ─── Step 2: Requirements ───────────────────────────────────────────── */

function RequirementsStep({
  requirements,
  setRequirements,
}: {
  requirements: Requirement[];
  setRequirements: (r: Requirement[]) => void;
}) {
  const { t } = useLanguage();
  const priorityLabel = (p: Priority) =>
    p === "High" ? t("tenderCreate.priHigh") : p === "Medium" ? t("tenderCreate.priMedium") : t("tenderCreate.priLow");
  const addReq = () =>
    setRequirements([
      ...requirements,
      { id: crypto.randomUUID(), text: "", priority: "Medium" },
    ]);

  const updateReq = (id: string, field: "text" | "priority", value: string) =>
    setRequirements(
      requirements.map((r) => (r.id === id ? { ...r, [field]: value } : r)),
    );

  const removeReq = (id: string) =>
    setRequirements(requirements.filter((r) => r.id !== id));

  return (
    <div className="flex flex-col gap-6">
      <div className="text-center">
        <h2 className="text-[20px] font-bold text-text-1">
          {t("tenderCreate.reqsTitle")}
        </h2>
        <p className="mt-1 text-[14px] text-text-2">
          {t("tenderCreate.reqsSubtitle")}
        </p>
      </div>

      <Button className="cursor-pointer gap-2 bg-primary-6 hover:bg-primary-7">
        <Sparkles className="h-4 w-4" />
        {t("tenderCreate.autoExtract")}
      </Button>

      <div className="flex items-center gap-3">
        <span className="h-px flex-1 bg-border-2" />
        <span className="text-[12px] font-medium uppercase tracking-wide text-text-3">
          {t("tenderCreate.orAddManually")}
        </span>
        <span className="h-px flex-1 bg-border-2" />
      </div>

      <div className="flex flex-col gap-4">
        {requirements.map((req, idx) => (
          <div
            key={req.id}
            className="flex flex-col gap-3 rounded-lg bg-bg-1 p-4"
          >
            <div className="flex items-start gap-3">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-bg-white text-[12px] font-semibold text-text-2">
                {idx + 1}
              </span>
              <div className="flex min-w-0 flex-1 flex-col gap-2">
                <Input
                  value={req.text}
                  onChange={(e) => updateReq(req.id, "text", e.target.value)}
                  placeholder={t("tenderCreate.reqPlaceholder")}
                  className="h-10"
                />
                <div className="flex items-center gap-2">
                  <span className="text-[12px] text-text-2">{t("tenderCreate.priority")}</span>
                  {(["High", "Medium", "Low"] as Priority[]).map((p) => (
                    <button
                      key={p}
                      type="button"
                      onClick={() => updateReq(req.id, "priority", p)}
                      className={`cursor-pointer rounded px-2.5 py-1 text-[12px] font-medium transition-colors ${
                        req.priority === p
                          ? "bg-primary-6 text-white"
                          : "border border-border-2 bg-bg-white text-text-2 hover:border-primary-6"
                      }`}
                    >
                      {priorityLabel(p)}
                    </button>
                  ))}
                </div>
              </div>
              {requirements.length > 1 && (
                <button
                  type="button"
                  onClick={() => removeReq(req.id)}
                  className="flex h-6 w-6 shrink-0 cursor-pointer items-center justify-center rounded text-text-3 hover:text-text-1"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          </div>
        ))}
      </div>

      <button
        type="button"
        onClick={addReq}
        className="inline-flex cursor-pointer items-center gap-2 self-start text-[14px] font-medium text-text-2 hover:text-primary-6"
      >
        <Plus className="h-4 w-4" />
        {t("tenderCreate.addAnother")}
      </button>
    </div>
  );
}

/* ─── Step 3: Team Assignment ────────────────────────────────────────── */

function TeamStep({
  selected,
  setSelected,
}: {
  selected: string[];
  setSelected: (s: string[]) => void;
}) {
  const { t } = useLanguage();
  const [search, setSearch] = useState("");

  const { data: orgUsers = [], isLoading: usersLoading } = useQuery({
    queryKey: ["org-users"],
    queryFn: fetchOrgUsers,
  });

  const filtered = orgUsers.filter((m) => {
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return (
      (m.name ?? "").toLowerCase().includes(q) ||
      m.email.toLowerCase().includes(q)
    );
  });

  const toggle = (id: string) =>
    setSelected(
      selected.includes(id)
        ? selected.filter((s) => s !== id)
        : [...selected, id],
    );

  const getInitials = (name: string | null) =>
    name
      ? name
          .split(" ")
          .map((w) => w[0])
          .join("")
      : "?";

  return (
    <div className="flex flex-col gap-6">
      <div className="text-center">
        <h2 className="text-[20px] font-bold text-text-1">
          {t("tenderCreate.teamTitle")}
        </h2>
        <p className="mt-1 text-[14px] text-text-2">
          {t("tenderCreate.teamSubtitle")}
        </p>
      </div>

      <div className="flex flex-col gap-4">
        <div className="flex items-center gap-2">
          <span className="h-5 w-1 rounded-full bg-primary-6" />
          <span className="text-[18px] font-bold leading-[1.3] text-text-1">
            {t("tenderCreate.availableMembers")}
          </span>
        </div>
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-3" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t("tenderCreate.searchPh")}
            className="h-10 pl-9"
          />
        </div>
        {usersLoading ? (
          <div className="flex justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin text-text-3" />
          </div>
        ) : (
        <div className="flex flex-col gap-2">
          {filtered.map((m) => {
            const isAdded = selected.includes(m.id);
            return (
              <div
                key={m.id}
                className="flex items-center gap-3 rounded-lg border border-border-2 bg-bg-white p-3"
              >
                {m.picture ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={m.picture}
                    alt={m.name ?? ""}
                    referrerPolicy="no-referrer"
                    className="h-9 w-9 shrink-0 rounded-full object-cover"
                  />
                ) : (
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary-6 text-[13px] font-semibold text-white">
                    {getInitials(m.name)}
                  </span>
                )}
                <div className="flex min-w-0 flex-1 flex-col">
                  <span className="text-[14px] font-medium text-text-1">
                    {m.name ?? m.email}
                  </span>
                  <span className="text-[12px] text-text-3">{m.email}</span>
                </div>
                <button
                  type="button"
                  onClick={() => toggle(m.id)}
                  className={`cursor-pointer rounded px-3 py-1 text-[12px] font-medium transition-colors ${
                    isAdded
                      ? "bg-success-1 text-success-7"
                      : "bg-bg-1 text-text-2 hover:bg-primary-6/10 hover:text-primary-6"
                  }`}
                >
                  {isAdded ? (
                    <span className="inline-flex items-center gap-1">
                      <Check className="h-3 w-3" />
                      {t("tenderCreate.added")}
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1">
                      <Plus className="h-3 w-3" />
                      {t("tenderCreate.add")}
                    </span>
                  )}
                </button>
              </div>
            );
          })}
        </div>
        )}
        <button
          type="button"
          className="inline-flex cursor-pointer items-center gap-2 self-start text-[14px] font-medium text-text-2 hover:text-primary-6"
        >
          <Mail className="h-4 w-4" />
          {t("tenderCreate.inviteExternal")}
        </button>
      </div>
    </div>
  );
}

/* ─── Step 4: Documents ──────────────────────────────────────────────── */

function DocumentsStep({
  files,
  setFiles,
}: {
  files: File[];
  setFiles: (f: File[]) => void;
}) {
  const { t } = useLanguage();
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const dropped = Array.from(e.dataTransfer.files);
    setFiles([...files, ...dropped]);
  };

  const handleSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = Array.from(e.target.files ?? []);
    setFiles([...files, ...selected]);
    e.target.value = "";
  };

  const removeFile = (idx: number) =>
    setFiles(files.filter((_, i) => i !== idx));

  return (
    <div className="flex flex-col gap-6">
      <div className="text-center">
        <h2 className="text-[20px] font-bold text-text-1">{t("tenderCreate.uploadDocs")}</h2>
        <p className="mt-1 text-[14px] text-text-2">
          {t("tenderCreate.uploadDocsSubtitle")}
        </p>
      </div>

      <div
        onDragOver={(e) => e.preventDefault()}
        onDrop={handleDrop}
        className="flex flex-col items-center gap-3 rounded-lg border-2 border-dashed border-border-2 bg-bg-white px-6 py-12 text-center"
      >
        <span className="flex h-12 w-12 items-center justify-center rounded-full bg-bg-1">
          <Upload className="h-5 w-5 text-text-3" />
        </span>
        <p className="text-[14px] font-medium text-text-1">
          {t("tenderCreate.dropFiles")}
        </p>
        <p className="text-[12px] text-text-3">
          {t("tenderCreate.supports")}
        </p>
        <label>
          <input
            type="file"
            multiple
            accept=".pdf,.docx,.xls,.xlsx"
            className="hidden"
            onChange={handleSelect}
          />
          <span className="inline-flex cursor-pointer items-center rounded-lg bg-primary-6 px-4 py-2 text-[13px] font-medium text-white transition-colors hover:bg-primary-7">
            {t("tenderCreate.selectFiles")}
          </span>
        </label>
      </div>

      {files.length > 0 && (
        <div className="flex flex-col gap-2">
          {files.map((f, i) => (
            <div
              key={i}
              className="flex items-center gap-3 rounded-lg border border-border-2 bg-bg-white p-3"
            >
              <FileText className="h-5 w-5 shrink-0 text-text-3" />
              <div className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-[13px] font-medium text-text-1">
                  {f.name}
                </span>
                <span className="text-[11px] text-text-3">
                  {(f.size / 1024 / 1024).toFixed(1)} MB
                </span>
              </div>
              <button
                type="button"
                onClick={() => removeFile(i)}
                className="flex h-6 w-6 shrink-0 cursor-pointer items-center justify-center rounded text-text-3 hover:text-text-1"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ─── Step 5: Review & Create ────────────────────────────────────────── */

function ReviewStep({
  basicInfo,
  requirements,
  selectedTeam,
  files,
  onEdit,
}: {
  basicInfo: BasicInfo;
  requirements: Requirement[];
  selectedTeam: string[];
  files: File[];
  onEdit: (step: number) => void;
}) {
  const { t } = useLanguage();
  const cards = [
    {
      title: t("tenderCreate.cardBasic"),
      subtitle: t("tenderCreate.cardBasicSub"),
      step: 0,
      rows: [
        { label: t("tenderCreate.tenderNameLabel"), value: basicInfo.name },
        { label: t("tenderCreate.clientLabel"), value: basicInfo.client },
        { label: t("tenderCreate.rfpNumberLabel"), value: basicInfo.rfpNumber },
        { label: t("tenderCreate.categoryLabel"), value: basicInfo.category },
        { label: t("tenderCreate.deadlineLabel"), value: basicInfo.deadline },
        { label: t("tenderCreate.valueLabel"), value: basicInfo.value ? (basicInfo.value.trim().startsWith("$") ? basicInfo.value : `$${basicInfo.value}`) : "" },
      ],
    },
    {
      title: t("tenderCreate.cardReqs"),
      subtitle: `${requirements.filter((r) => r.text.trim()).length} ${t("tenderCreate.reqsDefined")}`,
      step: 1,
      rows: [],
    },
    {
      title: t("tenderCreate.cardTeam"),
      subtitle: `${selectedTeam.length} ${t("tenderCreate.membersAssigned")}`,
      step: 2,
      rows: [],
    },
    {
      title: t("tenderCreate.cardDocs"),
      subtitle: `${files.length} ${t("tenderCreate.filesUploaded")}`,
      step: 3,
      rows: [],
    },
  ];

  return (
    <div className="flex flex-col gap-6">
      <div className="text-center">
        <h2 className="text-[20px] font-bold text-text-1">
          {t("tenderCreate.reviewTitle")}
        </h2>
        <p className="mt-1 text-[14px] text-text-2">
          {t("tenderCreate.reviewSubtitle")}
        </p>
      </div>

      <div className="flex flex-col gap-3">
        {cards.map((card) => (
          <div
            key={card.title}
            className="flex flex-col gap-3 rounded-lg border border-border-2 bg-bg-white p-4"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-3">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary-1">
                  <FileText className="h-4 w-4 text-primary-6" />
                </span>
                <div>
                  <h3 className="text-[14px] font-semibold text-text-1">
                    {card.title}
                  </h3>
                  <p className="text-[12px] text-text-3">{card.subtitle}</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => onEdit(card.step)}
                className="cursor-pointer text-[13px] font-medium text-primary-6 hover:text-primary-7"
              >
                {t("tenderCreate.edit")}
              </button>
            </div>
            {card.rows.length > 0 && (
              <div className="flex flex-col gap-1.5 pl-12 text-[13px]">
                {card.rows.map((r) => (
                  <div key={r.label} className="flex gap-2">
                    <span className="text-text-2">{r.label}</span>
                    <span className="font-medium text-text-1">
                      {r.value || t("tenderCreate.notProvided")}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* AI Analysis banner */}
      <div className="flex items-start gap-3 rounded-lg border border-primary-5/30 bg-primary-1 p-4">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary-6/10">
          <Sparkles className="h-4 w-4 text-primary-6" />
        </span>
        <div className="flex flex-col gap-1">
          <h3 className="text-[14px] font-semibold text-text-1">
            {t("tenderCreate.aiReady")}
          </h3>
          <p className="text-[13px] leading-[1.5] text-text-2">
            {t("tenderCreate.aiReadyDesc")}
          </p>
        </div>
      </div>
    </div>
  );
}

/* ─── Main page ──────────────────────────────────────────────────────── */

export default function CreateTenderPage() {
  const router = useRouter();
  const { t } = useLanguage();
  const [step, setStep] = useState(0);

  const [basicInfo, setBasicInfo] = useState<BasicInfo>({
    name: "",
    rfpNumber: "",
    category: "",
    client: "",
    deadline: "",
    value: "",
    description: "",
  });
  const [requirements, setRequirements] = useState<Requirement[]>([
    { id: crypto.randomUUID(), text: "", priority: "Medium" },
  ]);
  const [selectedTeam, setSelectedTeam] = useState<string[]>([]);
  const [files, setFiles] = useState<File[]>([]);
  const [stepTouched, setStepTouched] = useState<Set<number>>(new Set());

  const queryClient = useQueryClient();
  const createMutation = useMutation({
    mutationFn: createTender,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tenders"] });
      toast.success(t("tenderCreate.success"));
      router.push("/tender-ai");
    },
    onError: (err: Error) => {
      toast.error(err.message || t("tenderCreate.failed"));
    },
  });

  const validateStep = (s: number): string | null => {
    switch (s) {
      case 0: {
        if (!basicInfo.name.trim()) return t("tenderCreate.errName");
        if (!basicInfo.rfpNumber.trim()) return t("tenderCreate.errRfp");
        if (!basicInfo.category) return t("tenderCreate.errCategory");
        if (!basicInfo.client.trim()) return t("tenderCreate.errClient");
        if (!basicInfo.deadline) return t("tenderCreate.errDeadline");
        if (!basicInfo.value.trim()) return t("tenderCreate.errValue");
        if (!basicInfo.description.trim()) return t("tenderCreate.errDescription");
        return null;
      }
      case 1: {
        const filled = requirements.filter((r) => r.text.trim());
        if (filled.length === 0) return t("tenderCreate.errAtLeastReq");
        return null;
      }
      case 2:
        if (selectedTeam.length === 0)
          return t("tenderCreate.errAtLeastMember");
        return null;
      case 3:
        return null;
      default:
        return null;
    }
  };

  const handleNext = () => {
    setStepTouched((prev) => new Set(prev).add(step));
    const error = validateStep(step);
    if (error) {
      toast.error(error);
      return;
    }
    setStep((s) => s + 1);
  };

  const handleCreate = () => {
    for (let s = 0; s <= 3; s++) {
      const error = validateStep(s);
      if (error) {
        toast.error(error);
        setStep(s);
        return;
      }
    }
    createMutation.mutate({
      name: basicInfo.name,
      code: basicInfo.rfpNumber || undefined,
      organization: basicInfo.client || undefined,
      description: basicInfo.description || undefined,
      category: basicInfo.category || undefined,
      deadline: basicInfo.deadline || undefined,
      value: basicInfo.value || undefined,
      requirements: requirements
        .filter((r) => r.text.trim())
        .map((r) => ({ title: r.text, priority: r.priority })),
      teamMemberIds: selectedTeam,
    });
  };

  return (
    <div className="flex flex-col gap-0 lg:gap-6 lg:pb-6">
      {/* Mobile stepper (desktop stepper also shown below appbar) */}
      <MobileStepper active={step} />

      {/* Desktop stepper (horizontal, above content) */}
      <DesktopStepper active={step} />

      <div className="flex">
        {/* Content card */}
        <div className="flex min-w-0 flex-1 flex-col rounded-none border-0 bg-bg-white lg:border lg:border-border-2">
          <div className="flex-1 px-4 py-5 lg:p-6">
            {step === 0 && (
              <BasicInfoStep
                data={basicInfo}
                onChange={setBasicInfo}
                touched={stepTouched.has(0)}
              />
            )}
            {step === 1 && (
              <RequirementsStep
                requirements={requirements}
                setRequirements={setRequirements}
              />
            )}
            {step === 2 && (
              <TeamStep selected={selectedTeam} setSelected={setSelectedTeam} />
            )}
            {step === 3 && (
              <DocumentsStep files={files} setFiles={setFiles} />
            )}
            {step === 4 && (
              <ReviewStep
                basicInfo={basicInfo}
                requirements={requirements}
                selectedTeam={selectedTeam}
                files={files}
                onEdit={setStep}
              />
            )}
          </div>

          {/* Footer */}
          <div className={`flex items-center border-t border-border-2 px-6 py-4 ${step === 0 ? "justify-end" : "justify-between"}`}>
            {step > 0 && (
              <Button
                variant="outline"
                onClick={() => setStep((s) => s - 1)}
                className="cursor-pointer"
              >
                {t("tenderCreate.previous")}
              </Button>
            )}
            {step < 4 ? (
              <Button
                onClick={handleNext}
                className="cursor-pointer bg-primary-6 hover:bg-primary-7"
              >
                {t("tenderCreate.nextStep")}
              </Button>
            ) : (
              <Button
                onClick={handleCreate}
                disabled={createMutation.isPending}
                className="cursor-pointer gap-2 bg-primary-6 hover:bg-primary-7"
              >
                {createMutation.isPending && (
                  <Loader2 className="h-4 w-4 animate-spin" />
                )}
                {createMutation.isPending ? t("tenderCreate.creating") : t("tenderCreate.createTender")}
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
