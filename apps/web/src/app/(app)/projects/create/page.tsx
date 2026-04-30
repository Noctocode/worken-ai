"use client";

import { useState, useRef, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Briefcase,
  Code,
  HeadphonesIcon,
  Megaphone,
  Shield,
  TrendingUp,
  Users,
  Search,
  PenTool,
  Settings,
  Scale,
  Bot,
  Info,
  X,
  ChevronDown,
} from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  createProject,
  fetchTeams,
  // Kept for the (commented-out) "invite members on project create" flow.
  // The current flow attaches the project to an existing team instead, so
  // these imports are unused. Leaving them disabled rather than deleted in
  // case we bring the invite flow back as an opt-in.
  // inviteTeamMember,
  // fetchOrgUsers,
  // type OrgUser,
} from "@/lib/api";
import { useAvailableModels } from "@/lib/hooks/use-available-models";

/**
 * Each agent maps to a sensible default OpenRouter model. The mapping is
 * advisory: if the admin hasn't enabled the agent's preferred model in
 * the Catalog, we fall back to the first enabled model so project
 * creation never blocks. Tweak freely — these are starting points.
 */
const AGENTS = [
  { id: "general-assistant", label: "General Assistant", icon: Bot,
    model: "anthropic/claude-opus-4.6-fast" },
  { id: "business-development", label: "Business Development Specialist", icon: Briefcase,
    model: "openai/gpt-5.5" },
  { id: "marketing-strategist", label: "Marketing Strategist", icon: Megaphone,
    model: "anthropic/claude-opus-4.7" },
  { id: "customer-support", label: "Customer Support", icon: HeadphonesIcon,
    model: "openai/gpt-5.4-mini" },
  { id: "code-engineer", label: "Code Engineer", icon: Code,
    model: "anthropic/claude-opus-4.7" },
  { id: "security-advisor", label: "Security Advisor", icon: Shield,
    model: "anthropic/claude-opus-4.7" },
  { id: "sales-rep", label: "Sales Rep", icon: TrendingUp,
    model: "openai/gpt-5.5" },
  { id: "hr", label: "HR", icon: Users,
    model: "anthropic/claude-opus-4.6-fast" },
  { id: "seo-specialist", label: "SEO Specialist", icon: Search,
    model: "openai/gpt-5.5" },
  { id: "copywriter", label: "Copywriter", icon: PenTool,
    model: "anthropic/claude-opus-4.7" },
  { id: "automation-engineer", label: "Automation Engineer", icon: Settings,
    model: "deepseek/deepseek-v4-pro" },
  { id: "lawyer", label: "Lawyer", icon: Scale,
    model: "anthropic/claude-opus-4.7" },
] as const;

/* ─── Member picker (DISABLED) ────────────────────────────────────────────
 * Replaced by the Team selector below: instead of inviting individual members
 * during project creation, the user now picks an existing team — every member
 * of that team automatically has access to the new project. Kept commented
 * rather than deleted so we can revive it if we ever add a "Create new team
 * here" inline flow.
 *
 * function MemberPicker({
 *   selected,
 *   onAdd,
 *   onRemove,
 * }: {
 *   selected: { id: string; name: string }[];
 *   onAdd: (user: OrgUser) => void;
 *   onRemove: (id: string) => void;
 * }) {
 *   const [open, setOpen] = useState(false);
 *   const [search, setSearch] = useState("");
 *   const inputRef = useRef<HTMLInputElement>(null);
 *   const containerRef = useRef<HTMLDivElement>(null);
 *
 *   const { data: orgUsers = [] } = useQuery({
 *     queryKey: ["orgUsers"],
 *     queryFn: fetchOrgUsers,
 *   });
 *
 *   const selectedIds = new Set(selected.map((m) => m.id));
 *   const filtered = orgUsers.filter(
 *     (u) =>
 *       !selectedIds.has(u.id) &&
 *       (u.name?.toLowerCase().includes(search.toLowerCase()) ||
 *         u.email.toLowerCase().includes(search.toLowerCase())),
 *   );
 *
 *   useEffect(() => {
 *     const handleClickOutside = (e: MouseEvent) => {
 *       if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
 *         setOpen(false);
 *       }
 *     };
 *     document.addEventListener("mousedown", handleClickOutside);
 *     return () => document.removeEventListener("mousedown", handleClickOutside);
 *   }, []);
 *
 *   return (
 *     <div ref={containerRef} className="relative w-full">
 *       <div
 *         className="flex items-center gap-2 rounded-xl border border-border-2 px-3.5 py-3 cursor-text"
 *         onClick={() => { inputRef.current?.focus(); setOpen(true); }}
 *       >
 *         <div className="flex flex-1 flex-wrap items-center gap-2">
 *           {selected.map((m) => (
 *             <span key={m.id} className="flex items-center gap-0.5 rounded bg-bg-1 pl-2 pr-0.5 py-0.5 text-[12px] font-medium text-text-1">
 *               {m.name}
 *               <button
 *                 onClick={(e) => { e.stopPropagation(); onRemove(m.id); }}
 *                 className="p-1 rounded cursor-pointer hover:bg-bg-3"
 *               >
 *                 <X className="h-2 w-2" />
 *               </button>
 *             </span>
 *           ))}
 *           <input
 *             ref={inputRef}
 *             value={search}
 *             onChange={(e) => { setSearch(e.target.value); setOpen(true); }}
 *             onFocus={() => setOpen(true)}
 *             placeholder={selected.length === 0 ? "Search members..." : ""}
 *             className="flex-1 min-w-[80px] bg-transparent text-[14px] text-text-1 outline-none placeholder:text-text-3"
 *           />
 *         </div>
 *         <span className="flex items-center gap-1 text-[13px] text-text-1 whitespace-nowrap cursor-pointer">
 *           Can Edit
 *           <ChevronDown className="h-3.5 w-3.5 text-text-3" />
 *         </span>
 *       </div>
 *
 *       {open && filtered.length > 0 && (
 *         <div className="absolute z-10 mt-1 w-full max-h-[200px] overflow-auto rounded-lg border border-border-2 bg-bg-white shadow-lg">
 *           {filtered.map((u) => (
 *             <button
 *               key={u.id}
 *               className="flex w-full items-center gap-2 px-3 py-2 text-left text-[14px] text-text-1 cursor-pointer hover:bg-bg-1 transition-colors"
 *               onClick={() => { onAdd(u); setSearch(""); setOpen(false); }}
 *             >
 *               <span className="truncate">{u.name ?? u.email}</span>
 *               <span className="text-[12px] text-text-3 truncate">{u.email}</span>
 *             </button>
 *           ))}
 *         </div>
 *       )}
 *     </div>
 *   );
 * }
 */

/* ─── Main page ──────────────────────────────────────────────────────────── */

export default function CreateProjectPage() {
  const router = useRouter();
  const queryClient = useQueryClient();

  const [projectName, setProjectName] = useState("");
  const [nameError, setNameError] = useState(false);
  const [teamError, setTeamError] = useState(false);
  const [projectType, setProjectType] = useState<"personal" | "team">("personal");
  const [selectedAgent, setSelectedAgent] = useState<string>("general-assistant");
  const [selectedTeamId, setSelectedTeamId] = useState<string>("");
  // const [selectedMembers, setSelectedMembers] = useState<{ id: string; name: string; email: string }[]>([]);
  // const [membersError, setMembersError] = useState(false);

  const { data: teams } = useQuery({
    queryKey: ["teams"],
    queryFn: fetchTeams,
    enabled: projectType === "team",
  });

  const { models: availableModels } = useAvailableModels();

  // Only teams the user can actually create a project in. Mirrors the BE
  // gate in projects.service.create() (owner|editor required).
  const manageableTeams = teams?.filter((t) => t.canManage) ?? [];

  // Auto-select the first manageable team once they load.
  useEffect(() => {
    if (manageableTeams.length > 0 && !selectedTeamId) {
      setSelectedTeamId(manageableTeams[0].id);
    }
  }, [manageableTeams, selectedTeamId]);

  const mutation = useMutation({
    mutationFn: createProject,
    onSuccess: (project) => {
      queryClient.invalidateQueries({ queryKey: ["projects"] });
      router.push(`/projects/${project.id}`);
    },
  });

  const handleSubmit = () => {
    const name = projectName.trim();
    const needsTeam = projectType === "team" && !selectedTeamId;
    if (!name || needsTeam) {
      if (!name) setNameError(true);
      if (needsTeam) setTeamError(true);
      return;
    }
    const agent = AGENTS.find((a) => a.id === selectedAgent);
    if (!agent) return;
    if (availableModels.length === 0) {
      // Admin hasn't enabled any models yet — surface a clear error rather
      // than silently submitting with an empty model id.
      setNameError(false);
      alert(
        "No models are enabled in this workspace. Ask an admin to enable at least one model in Models → Catalog.",
      );
      return;
    }
    // Prefer the model recommended for this agent. If the admin hasn't
    // enabled it in the Catalog, fall back to the first enabled model so
    // project creation never blocks on missing config.
    const preferredModel = availableModels.find((m) => m.id === agent.model);
    const model = preferredModel?.id ?? availableModels[0].id;
    mutation.mutate({
      name,
      description: `${agent.label} project`,
      model,
      teamId: projectType === "team" && selectedTeamId ? selectedTeamId : undefined,
    });
  };

  return (
    <div className="-mx-6 -mb-6 flex flex-col" style={{ minHeight: "calc(100vh - 4.5rem)" }}>
      {/* Content */}
      <div className="flex-1 flex flex-col items-center gap-8 pt-16 pb-8 px-6">
          {/* Project Name */}
          <div className="flex flex-col w-[414px]">
            <input
              type="text"
              value={projectName}
              onChange={(e) => { setProjectName(e.target.value); setNameError(false); }}
              placeholder="Project Name"
              className={`w-full rounded-[6px] border bg-bg-white px-[13px] py-[9px] text-[16px] text-text-1 outline-none placeholder:text-text-3 focus:border-primary-6 focus:ring-[1px] focus:ring-primary-6/30 ${nameError ? "border-danger-5" : "border-border-3"}`}
            />
            {nameError && (
              <span className="mt-1 text-[13px] text-danger-5">Project name is required</span>
            )}
          </div>

          {/* Select Project Type */}
          <div className="flex flex-col items-center gap-4 w-full max-w-[600px]">
            <h2 className="text-[23px] font-bold text-text-1">Select Project Type</h2>

            <div className="flex rounded-lg border border-border-3 overflow-hidden">
              <button
                onClick={() => { setProjectType("personal"); setTeamError(false); }}
                className={`flex items-center justify-center gap-2 w-[150px] py-3 text-[16px] cursor-pointer transition-colors ${
                  projectType === "personal"
                    ? "bg-primary-6 text-white"
                    : "bg-bg-white text-text-1 hover:bg-bg-1"
                }`}
              >
                Personal
                <Info className="h-[18px] w-[18px] opacity-60" />
              </button>
              <button
                onClick={() => setProjectType("team")}
                className={`flex items-center justify-center gap-2 w-[150px] py-3 text-[16px] cursor-pointer transition-colors ${
                  projectType === "team"
                    ? "bg-primary-6 text-white"
                    : "bg-bg-white text-text-1 hover:bg-bg-1"
                }`}
              >
                Team
                <Info className="h-[18px] w-[18px] opacity-60" />
              </button>
            </div>

            <p className="text-[14px] text-text-2 text-center leading-normal">
              {projectType === "personal" ? (
                <>
                  A dedicated space to create and test your own AI chatbots.<br />
                  Design conversations, craft prompts, and iterate privately at your own pace.
                </>
              ) : (
                <>
                  A shared workspace for building AI chat experiences together.<br />
                  Collaborate on chatbot design, manage shared prompts, and coordinate updates in one place.
                </>
              )}
            </p>

            {/* Team picker — choose which existing team the project belongs to.
                Replaces the previous "search & invite members" flow: every
                member of the selected team automatically gets access. */}
            {projectType === "team" && (
              <div className="flex flex-col w-full">
                {manageableTeams.length === 0 ? (
                  <div className="rounded-lg border border-border-2 bg-bg-1 px-4 py-3 text-[14px] text-text-2">
                    You don&apos;t own or co-manage any teams yet.{" "}
                    <Link href="/teams" className="text-primary-6 hover:underline">
                      Create a team first
                    </Link>{" "}
                    to add a team project.
                  </div>
                ) : (
                  <Select
                    value={selectedTeamId}
                    onValueChange={(v) => { setSelectedTeamId(v); setTeamError(false); }}
                  >
                    <SelectTrigger
                      className={`w-full cursor-pointer rounded-lg text-[16px] text-text-1 data-[size=default]:h-12 ${
                        teamError ? "border-danger-5" : "border-border-2"
                      }`}
                    >
                      <SelectValue placeholder="Select a team..." />
                    </SelectTrigger>
                    <SelectContent>
                      {manageableTeams.map((t) => (
                        <SelectItem
                          key={t.id}
                          value={t.id}
                          className="cursor-pointer text-[16px]"
                        >
                          {t.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
                {teamError && (
                  <span className="mt-1 text-[13px] text-danger-5">Please select a team</span>
                )}
              </div>
            )}
          </div>

          {/* Select Agent */}
          <div className="flex flex-col items-center gap-4 w-full">
            <h2 className="text-[23px] font-bold text-text-1">Select Agent</h2>

            <div className="flex flex-wrap gap-2.5 justify-center w-full max-w-[900px]">
              {AGENTS.map((agent) => {
                const Icon = agent.icon;
                const isSelected = selectedAgent === agent.id;
                const resolvedModel =
                  availableModels.find((m) => m.id === agent.model) ??
                  availableModels[0];
                const willFallback =
                  resolvedModel != null && resolvedModel.id !== agent.model;
                return (
                  <button
                    key={agent.id}
                    onClick={() => setSelectedAgent(agent.id)}
                    title={
                      resolvedModel
                        ? willFallback
                          ? `Preferred ${agent.model} not enabled — will use ${resolvedModel.name}`
                          : `Uses ${resolvedModel.name}`
                        : agent.model
                    }
                    className={`flex flex-col items-center gap-2.5 p-4 min-w-[200px] flex-1 max-w-[220px] cursor-pointer transition-colors ${
                      isSelected
                        ? "bg-primary-1 border border-primary-6"
                        : "bg-bg-1 border border-transparent hover:border-border-3"
                    }`}
                  >
                    <div className="flex h-[60px] w-[60px] items-center justify-center rounded-xl bg-[rgba(60,126,255,0.2)]">
                      <Icon className="h-10 w-10 text-primary-6" />
                    </div>
                    <span className="text-[13px] text-text-2 whitespace-nowrap">{agent.label}</span>
                    {resolvedModel && (
                      <span
                        className={`text-[11px] truncate max-w-full ${
                          willFallback ? "text-warning-6" : "text-text-3"
                        }`}
                      >
                        {willFallback
                          ? `↳ ${resolvedModel.name} (fallback)`
                          : resolvedModel.name}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        </div>

      {/* Bottom bar */}
      <div className="sticky bottom-0 flex items-center justify-between bg-bg-white px-6 py-4">
        <Button
          variant="outline"
          className="h-[43px] w-[97px] rounded-lg border-border-2 text-[16px] text-text-1 cursor-pointer"
          onClick={() => router.back()}
        >
          Cancel
        </Button>
        <Button
          className="h-10 w-[174px] rounded-lg bg-primary-6 hover:bg-primary-7 text-[16px] text-white cursor-pointer"
          onClick={handleSubmit}
          disabled={mutation.isPending || !selectedAgent}
        >
          {mutation.isPending ? "Creating..." : "Create Project"}
        </Button>
      </div>
    </div>
  );
}
