"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  Calendar,
  Check,
  DollarSign,
  FileText,
  Loader2,
  Mail,
  Plus,
  Search,
  Sparkles,
  Upload,
  X,
} from "lucide-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { createTender } from "@/lib/api";

const STEPS = [
  { title: "Basic Information", caption: "Step 1 of 5" },
  { title: "Requirements", caption: "Step 2 of 5" },
  { title: "Team Assignment", caption: "Step 3 of 5" },
  { title: "Documents", caption: "Step 4 of 5" },
  { title: "Review & Create", caption: "Step 5 of 5" },
] as const;

type Priority = "High" | "Medium" | "Low";

interface Requirement {
  id: string;
  text: string;
  priority: Priority;
}

interface TeamMember {
  id: string;
  name: string;
  role: string;
  color: string;
}

const AVAILABLE_MEMBERS: TeamMember[] = [
  { id: "1", name: "Sarah Mitchell", role: "Solutions Architect", color: "bg-[#33AFF3]" },
  { id: "2", name: "James Chen", role: "Cloud Specialist", color: "bg-[#009A29]" },
  { id: "3", name: "Maria Rodriguez", role: "Compliance Lead", color: "bg-[#FF7D00]" },
  { id: "4", name: "David Park", role: "Technical Writer", color: "bg-[#F53F3F]" },
  { id: "5", name: "Dr. Emily Watson", role: "AI Research Lead", color: "bg-[#8B5CF6]" },
];

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
  return (
    <nav className="hidden w-[220px] shrink-0 flex-col gap-0 lg:flex">
      {STEPS.map((s, i) => {
        const done = i < active;
        const current = i === active;
        return (
          <div key={i} className="flex gap-3">
            <div className="flex flex-col items-center">
              <span
                className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[13px] font-semibold ${
                  done || current
                    ? "bg-primary-6 text-white"
                    : "border border-border-2 bg-bg-white text-text-3"
                }`}
              >
                {done ? <Check className="h-4 w-4" /> : i + 1}
              </span>
              {i < STEPS.length - 1 && (
                <span
                  className={`w-px flex-1 min-h-[32px] ${
                    done ? "bg-primary-6" : "bg-border-2"
                  }`}
                />
              )}
            </div>
            <div className="flex flex-col pb-8">
              <span
                className={`text-[14px] font-medium ${
                  current || done ? "text-text-1" : "text-text-3"
                }`}
              >
                {s.title}
              </span>
              <span className="text-[12px] text-text-3">{s.caption}</span>
            </div>
          </div>
        );
      })}
    </nav>
  );
}

function MobileStepper({ active }: { active: number }) {
  return (
    <nav className="flex items-center gap-0 border border-[#E0E0E6] bg-bg-white px-4 py-3 lg:hidden">
      {STEPS.map((s, i) => {
        const done = i < active;
        const current = i === active;
        return (
          <div key={i} className="flex flex-1 items-center">
            <div className="flex flex-col items-center gap-1">
              <span
                className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold ${
                  done || current
                    ? "bg-primary-6 text-white"
                    : "border border-border-2 bg-bg-white text-text-3"
                }`}
              >
                {done ? <Check className="h-3 w-3" /> : i + 1}
              </span>
              <span
                className={`text-center text-[9px] leading-tight ${
                  current ? "font-medium text-text-1" : "text-text-3"
                }`}
              >
                {s.title}
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
}: {
  data: BasicInfo;
  onChange: (d: BasicInfo) => void;
}) {
  const update = (field: keyof BasicInfo, value: string) =>
    onChange({ ...data, [field]: value });

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-[20px] font-bold text-text-1">Basic Information</h2>
        <p className="mt-1 text-[14px] text-text-2">
          Let&apos;s start with the essential details about this tender
          opportunity.
        </p>
      </div>

      {/* Essential Details */}
      <fieldset className="flex flex-col gap-4">
        <legend className="flex items-center gap-2 text-[14px] font-semibold text-text-1">
          <span className="h-2 w-2 rounded-full bg-primary-6" />
          Essential Details
        </legend>
        <div className="flex flex-col gap-1">
          <label className="text-[13px] font-medium text-text-1">
            Tender Name *
          </label>
          <Input
            value={data.name}
            onChange={(e) => update("name", e.target.value)}
            placeholder="Enter a clear, descriptive name for this tender"
            className="h-10"
          />
          <span className="text-[12px] text-text-3">
            Example: Enterprise Cloud Migration Services Q2 2026
          </span>
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-1">
            <label className="text-[13px] font-medium text-text-1">
              RFP/Tender Number *
            </label>
            <Input
              value={data.rfpNumber}
              onChange={(e) => update("rfpNumber", e.target.value)}
              placeholder="TND-2026-006"
              className="h-10"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-[13px] font-medium text-text-1">
              Category *
            </label>
            <Input
              value={data.category}
              onChange={(e) => update("category", e.target.value)}
              placeholder="Select category"
              className="h-10"
            />
          </div>
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-[13px] font-medium text-text-1">
            Client Name *
          </label>
          <Input
            value={data.client}
            onChange={(e) => update("client", e.target.value)}
            placeholder="Federal Aviation Administration"
            className="h-10"
          />
        </div>
      </fieldset>

      {/* Timeline & Budget */}
      <fieldset className="flex flex-col gap-4">
        <legend className="flex items-center gap-2 text-[14px] font-semibold text-text-1">
          <span className="h-2 w-2 rounded-full bg-primary-6" />
          Timeline &amp; Budget
        </legend>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-1">
            <label className="text-[13px] font-medium text-text-1">
              Submission Deadline *
            </label>
            <div className="relative">
              <Calendar className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-3" />
              <Input
                type="date"
                value={data.deadline}
                onChange={(e) => update("deadline", e.target.value)}
                className="h-10 pl-9"
              />
            </div>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-[13px] font-medium text-text-1">
              Contract Value *
            </label>
            <div className="relative">
              <DollarSign className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-3" />
              <Input
                value={data.value}
                onChange={(e) => update("value", e.target.value)}
                placeholder="2,400,000"
                className="h-10 pl-9"
              />
            </div>
            <span className="text-[12px] text-text-3">
              Enter numeric value (e.g., 2400000 or $2.4M)
            </span>
          </div>
        </div>
      </fieldset>

      {/* Description */}
      <fieldset className="flex flex-col gap-4">
        <legend className="flex items-center gap-2 text-[14px] font-semibold text-text-1">
          <span className="h-2 w-2 rounded-full bg-primary-6" />
          Project Description
        </legend>
        <div className="flex flex-col gap-1">
          <label className="text-[13px] font-medium text-text-1">
            Description *
          </label>
          <Textarea
            value={data.description}
            onChange={(e) => update("description", e.target.value)}
            placeholder="Provide a comprehensive overview of the tender opportunity, including scope, objectives, and key deliverables..."
            className="min-h-[120px]"
          />
          <div className="flex items-center justify-between text-[12px] text-text-3">
            <span>
              Be specific about scope, deliverables, and success criteria
            </span>
            <span>{data.description.length} characters</span>
          </div>
        </div>
      </fieldset>
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
      <div>
        <h2 className="text-[20px] font-bold text-text-1">
          Tender Requirements
        </h2>
        <p className="mt-1 text-[14px] text-text-2">
          Define the key requirements from the RFP. Our AI will match these
          against your Knowledge Core.
        </p>
      </div>

      <Button className="cursor-pointer gap-2 bg-primary-6 hover:bg-primary-7">
        <Sparkles className="h-4 w-4" />
        Auto-Extract Requirements from RFP Document
      </Button>

      <div className="flex items-center gap-3">
        <span className="h-px flex-1 bg-border-2" />
        <span className="text-[12px] font-medium uppercase tracking-wide text-text-3">
          Or add manually
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
                  placeholder="Describe the requirement in detail (e.g., AWS Certified Solutions Architect - Professional certification required for minimum 3 team members)"
                  className="h-10"
                />
                <div className="flex items-center gap-2">
                  <span className="text-[12px] text-text-2">Priority:</span>
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
                      {p}
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
        Add Another Requirement
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
  const [search, setSearch] = useState("");

  const filtered = AVAILABLE_MEMBERS.filter((m) => {
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return (
      m.name.toLowerCase().includes(q) || m.role.toLowerCase().includes(q)
    );
  });

  const toggle = (id: string) =>
    setSelected(
      selected.includes(id)
        ? selected.filter((s) => s !== id)
        : [...selected, id],
    );

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-[20px] font-bold text-text-1">
          Assign Team Members
        </h2>
        <p className="mt-1 text-[14px] text-text-2">
          Select team members and define their access levels for this tender.
        </p>
      </div>

      <fieldset className="flex flex-col gap-4">
        <legend className="flex items-center gap-2 text-[14px] font-semibold text-text-1">
          <span className="h-2 w-2 rounded-full bg-primary-6" />
          Available Team Members
        </legend>
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-3" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name, team or role..."
            className="h-10 pl-9"
          />
        </div>
        <div className="flex flex-col gap-2">
          {filtered.map((m) => {
            const isAdded = selected.includes(m.id);
            return (
              <div
                key={m.id}
                className="flex items-center gap-3 rounded-lg border border-border-2 bg-bg-white p-3"
              >
                <span
                  className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[13px] font-semibold text-white ${m.color}`}
                >
                  {m.name
                    .split(" ")
                    .map((w) => w[0])
                    .join("")}
                </span>
                <div className="flex min-w-0 flex-1 flex-col">
                  <span className="text-[14px] font-medium text-text-1">
                    {m.name}
                  </span>
                  <span className="text-[12px] text-text-3">{m.role}</span>
                </div>
                <button
                  type="button"
                  onClick={() => toggle(m.id)}
                  className={`cursor-pointer rounded px-3 py-1 text-[12px] font-medium transition-colors ${
                    isAdded
                      ? "bg-[#E8FFEA] text-[#009A29]"
                      : "bg-bg-1 text-text-2 hover:bg-primary-6/10 hover:text-primary-6"
                  }`}
                >
                  {isAdded ? (
                    <span className="inline-flex items-center gap-1">
                      <Check className="h-3 w-3" />
                      Added
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1">
                      <Plus className="h-3 w-3" />
                      Add
                    </span>
                  )}
                </button>
              </div>
            );
          })}
        </div>
        <button
          type="button"
          className="inline-flex cursor-pointer items-center gap-2 self-start text-[14px] font-medium text-text-2 hover:text-primary-6"
        >
          <Mail className="h-4 w-4" />
          Invite External Team Member
        </button>
      </fieldset>
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
      <div>
        <h2 className="text-[20px] font-bold text-text-1">Upload Documents</h2>
        <p className="mt-1 text-[14px] text-text-2">
          Upload the RFP document and any supporting materials.
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
          Drop files here or click to browse
        </p>
        <p className="text-[12px] text-text-3">
          Supports PDF, DOCX, XLSX (Max 50MB per file)
        </p>
        <label>
          <input
            type="file"
            multiple
            accept=".pdf,.docx,.xlsx,.doc,.xls"
            className="hidden"
            onChange={handleSelect}
          />
          <span className="inline-flex cursor-pointer items-center rounded-lg bg-primary-6 px-4 py-2 text-[13px] font-medium text-white transition-colors hover:bg-primary-7">
            Select Files
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
  const cards = [
    {
      title: "Basic Information",
      subtitle: "Essential tender details",
      step: 0,
      rows: [
        { label: "Tender Name:", value: basicInfo.name },
        { label: "Client:", value: basicInfo.client },
        { label: "RFP Number:", value: basicInfo.rfpNumber },
        { label: "Category:", value: basicInfo.category },
        { label: "Deadline:", value: basicInfo.deadline },
        { label: "Value:", value: basicInfo.value ? (basicInfo.value.trim().startsWith("$") ? basicInfo.value : `$${basicInfo.value}`) : "" },
      ],
    },
    {
      title: "Requirements",
      subtitle: `${requirements.filter((r) => r.text.trim()).length} requirements defined`,
      step: 1,
      rows: [],
    },
    {
      title: "Team Members",
      subtitle: `${selectedTeam.length} members assigned`,
      step: 2,
      rows: [],
    },
    {
      title: "Documents",
      subtitle: `${files.length} files uploaded`,
      step: 3,
      rows: [],
    },
  ];

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-[20px] font-bold text-text-1">
          Review &amp; Create Tender
        </h2>
        <p className="mt-1 text-[14px] text-text-2">
          Please review all information before creating the tender. You can go
          back to edit any section.
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
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#EBF8FF]">
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
                Edit
              </button>
            </div>
            {card.rows.length > 0 && (
              <div className="flex flex-col gap-1.5 pl-12 text-[13px]">
                {card.rows.map((r) => (
                  <div key={r.label} className="flex gap-2">
                    <span className="text-text-2">{r.label}</span>
                    <span className="font-medium text-text-1">
                      {r.value || "Not provided"}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* AI Analysis banner */}
      <div className="flex items-start gap-3 rounded-lg border border-[#33AFF3]/30 bg-[#EBF8FF] p-4">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary-6/10">
          <Sparkles className="h-4 w-4 text-primary-6" />
        </span>
        <div className="flex flex-col gap-1">
          <h3 className="text-[14px] font-semibold text-text-1">
            AI Analysis Ready
          </h3>
          <p className="text-[13px] leading-[1.5] text-text-2">
            After creation, our AI will automatically analyze all requirements
            and match them against your Knowledge Core to identify capability
            gaps, suggest relevant case studies, and generate actionable items
            for your team.
          </p>
        </div>
      </div>
    </div>
  );
}

/* ─── Main page ──────────────────────────────────────────────────────── */

export default function CreateTenderPage() {
  const router = useRouter();
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

  const queryClient = useQueryClient();
  const createMutation = useMutation({
    mutationFn: createTender,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tenders"] });
      toast.success("Tender created successfully!");
      router.push("/tender-ai");
    },
    onError: (err: Error) => {
      toast.error(err.message || "Failed to create tender.");
    },
  });

  const handleCreate = () => {
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
    <div className="flex flex-col gap-0 lg:gap-6 lg:py-6">
      {/* Back link (desktop) */}
      <Link
        href="/tender-ai"
        className="hidden w-fit cursor-pointer items-center gap-1.5 text-[13px] font-medium text-text-2 hover:text-primary-6 lg:inline-flex"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to Dashboard
      </Link>

      {/* Mobile back + stepper */}
      <div className="flex flex-col lg:hidden">
        <div className="flex items-center gap-2 px-4 py-3">
          <Link
            href="/tender-ai"
            className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-md bg-bg-1 text-text-1"
          >
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <span className="text-[13px] text-text-2">Back to Dashboard</span>
        </div>
        <MobileStepper active={step} />
      </div>

      <div className="flex gap-8">
        {/* Desktop stepper */}
        <DesktopStepper active={step} />

        {/* Content card */}
        <div className="flex min-w-0 flex-1 flex-col rounded-none border-0 bg-bg-white lg:rounded lg:border lg:border-border-2">
          <div className="flex-1 px-4 py-5 lg:p-6">
            {step === 0 && (
              <BasicInfoStep data={basicInfo} onChange={setBasicInfo} />
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
          <div className="flex items-center justify-between border-t border-border-2 px-6 py-4">
            <Button
              variant="outline"
              disabled={step === 0}
              onClick={() => setStep((s) => s - 1)}
              className="cursor-pointer"
            >
              Previous
            </Button>
            {step < 4 ? (
              <Button
                onClick={() => setStep((s) => s + 1)}
                className="cursor-pointer bg-primary-6 hover:bg-primary-7"
              >
                Next Step
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
                {createMutation.isPending ? "Creating..." : "Create Tender"}
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
