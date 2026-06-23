"use client";

import { useState, useEffect, useMemo } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Info } from "lucide-react";
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
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  createProject,
  DuplicateProjectNameError,
  fetchEffectiveModels,
  fetchTeams,
  // Kept for the (commented-out) "invite members on project create" flow.
  // The current flow attaches the project to an existing team instead, so
  // these imports are unused. Leaving them disabled rather than deleted in
  // case we bring the invite flow back as an opt-in.
  // inviteTeamMember,
  // fetchOrgUsers,
  // type OrgUser,
} from "@/lib/api";
import { useIsPersonal } from "@/lib/hooks/use-is-personal";
import { useLanguage } from "@/lib/i18n";

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
  const { t } = useLanguage();
  // Team projects are a company-tenant feature — a personal profile is
  // a sole account with no teammates to share with. The Team type is
  // disabled (not removed) with a hover reason; switching profile type
  // in My Account re-enables it.
  const isPersonal = useIsPersonal();

  const [projectName, setProjectName] = useState("");
  const [nameError, setNameError] = useState(false);
  // Set when the API rejects a duplicate name (409) on submit; cleared as
  // soon as the user edits the name.
  const [nameTaken, setNameTaken] = useState(false);
  const [teamError, setTeamError] = useState(false);
  const [projectType, setProjectType] = useState<"personal" | "team">("personal");
  // Multi-select pool of model ids. The first becomes the project's active
  // model; the rest are switchable from the project header.
  const [selectedModelIds, setSelectedModelIds] = useState<string[]>([]);
  const [selectedTeamId, setSelectedTeamId] = useState<string>("");
  // const [selectedMembers, setSelectedMembers] = useState<{ id: string; name: string; email: string }[]>([]);
  // const [membersError, setMembersError] = useState(false);

  const { data: teams } = useQuery({
    queryKey: ["teams"],
    queryFn: fetchTeams,
    enabled: projectType === "team",
  });

  // Models are company-wide now (admin-managed under the Models tab, no
  // longer tied to a team), so the picker shows the full available pool
  // regardless of personal vs team project — no per-scope narrowing.
  const { data: configuredModels = [] } = useQuery({
    queryKey: ["models", "effective", "all"],
    queryFn: () => fetchEffectiveModels(),
  });
  // Any model routed through an own key / endpoint (BYOK or Custom LLM) is
  // marked "(custom)"; managed catalog models get no suffix.
  const routingSuffix = (routing: string): string =>
    routing === "byok" || routing === "custom" ? " (custom)" : "";

  const toggleModel = (id: string) =>
    setSelectedModelIds((prev) =>
      prev.includes(id) ? prev.filter((m) => m !== id) : [...prev, id],
    );

  // Only teams the user can actually create a project in. Mirrors the BE
  // gate in projects.service.create() (owner|editor required). Memoized so
  // the auto-select effect below doesn't re-run on every render.
  const manageableTeams = useMemo(
    () => teams?.filter((team) => team.canManage) ?? [],
    [teams],
  );

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
    onError: (err) => {
      if (err instanceof DuplicateProjectNameError) setNameTaken(true);
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
    setNameTaken(false);
    const teamId =
      projectType === "team" && selectedTeamId ? selectedTeamId : undefined;

    // A pool of selected models. The first is the active model; the rest are
    // switchable from the project header (model ids live in `agents`).
    if (selectedModelIds.length === 0) return; // Create disabled until picked.
    const active = selectedModelIds[0];
    const picked = configuredModels.find((m) => m.id === active);
    mutation.mutate({
      name,
      description: `${picked?.name ?? active} project`,
      model: active,
      agent: active,
      agents: selectedModelIds,
      teamId,
    });
  };

  return (
    <div
      className="-mx-6 -mb-6 flex flex-col bg-bg-1 md:bg-transparent"
      style={{ minHeight: "calc(100vh - 4.5rem)" }}
    >
      {/* Mobile title row — the appbar collapses to MobileTopbar at
          <md (logo + hamburger only), so the page owns the title at
          that breakpoint. md+ keeps the appbar createProject variant
          unchanged. */}
      <div className="md:hidden flex items-center bg-bg-white px-4 py-4 border-b border-bg-1">
        <h1 className="text-[20px] font-bold text-text-1">{t("projectCreate.title")}</h1>
      </div>

      {/* Content */}
      <div className="flex-1 flex flex-col items-stretch md:items-center gap-6 md:gap-8 px-4 md:px-6 pt-6 md:pt-16 pb-8">
        {/* Project Name */}
        <div className="flex flex-col w-full md:w-[414px]">
          <input
            type="text"
            value={projectName}
            onChange={(e) => { setProjectName(e.target.value); setNameError(false); setNameTaken(false); }}
            placeholder={t("projectCreate.projectNamePlaceholder")}
            className={`w-full rounded-[6px] border bg-bg-white px-[13px] py-[9px] text-[16px] text-text-1 outline-none placeholder:text-text-3 focus:border-primary-6 focus:ring-[1px] focus:ring-primary-6/30 ${nameError || nameTaken ? "border-danger-5" : "border-border-3"}`}
          />
          {nameError && (
            <span className="mt-1 text-[13px] text-danger-5">{t("projectCreate.nameRequired")}</span>
          )}
          {nameTaken && (
            <span className="mt-1 text-[13px] text-danger-5">{t("projectCreate.nameTaken")}</span>
          )}
        </div>

        {/* Select Project Type — wrapped in a white card on mobile per
            Figma 4659:69759; transparent on desktop so the section
            sits flush with the page bg. */}
        <div className="flex flex-col items-stretch md:items-center gap-4 w-full md:max-w-[600px] rounded-xl md:rounded-none bg-bg-white md:bg-transparent px-4 py-5 md:p-0">
          <h2 className="text-[18px] sm:text-[23px] font-bold text-text-1">{t("projectCreate.selectType")}</h2>

          <div className="flex w-full md:w-auto rounded-lg border border-border-3 overflow-hidden">
            <button
              onClick={() => { setProjectType("personal"); setTeamError(false); }}
              className={`flex flex-1 md:flex-none md:w-[150px] items-center justify-center gap-2 py-3 text-[16px] cursor-pointer transition-colors ${
                projectType === "personal"
                  ? "bg-primary-6 text-white"
                  : "bg-bg-white text-text-1 hover:bg-bg-1"
              }`}
            >
              {t("common.personal")}
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="inline-flex items-center">
                    <Info className="h-[18px] w-[18px] opacity-60" />
                  </span>
                </TooltipTrigger>
                <TooltipContent className="max-w-xs text-center">
                  {t("projectCreate.personalTooltip")}
                </TooltipContent>
              </Tooltip>
            </button>
            <button
              onClick={() => {
                if (!isPersonal) setProjectType("team");
              }}
              aria-disabled={isPersonal}
              className={`flex flex-1 md:flex-none md:w-[150px] items-center justify-center gap-2 py-3 text-[16px] transition-colors ${
                isPersonal
                  ? "cursor-not-allowed bg-bg-white text-text-3 opacity-60"
                  : projectType === "team"
                    ? "bg-primary-6 text-white cursor-pointer"
                    : "bg-bg-white text-text-1 hover:bg-bg-1 cursor-pointer"
              }`}
            >
              {t("common.team")}
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="inline-flex items-center">
                    <Info className="h-[18px] w-[18px] opacity-60" />
                  </span>
                </TooltipTrigger>
                <TooltipContent className="max-w-xs text-center">
                  {isPersonal
                    ? t("projectCreate.teamPersonalDisabled")
                    : t("projectCreate.teamTooltip")}
                </TooltipContent>
              </Tooltip>
            </button>
          </div>

          <p className="text-[14px] text-text-2 md:text-center leading-normal">
            {projectType === "personal"
              ? t("projectCreate.personalDesc")
              : t("projectCreate.teamDesc")}
          </p>

          {/* Team picker — choose which existing team the project belongs to.
              Replaces the previous "search & invite members" flow: every
              member of the selected team automatically gets access. */}
          {projectType === "team" && (
            <div className="flex flex-col w-full">
              {manageableTeams.length === 0 ? (
                <div className="rounded-lg border border-border-2 bg-bg-1 px-4 py-3 text-[14px] text-text-2">
                  {t("projectCreate.noTeams")}{" "}
                  <Link href="/teams" className="text-primary-6 hover:underline">
                    {t("projectCreate.createTeamFirst")}
                  </Link>{" "}
                  {t("projectCreate.noTeamsSuffix")}
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
                    <SelectValue placeholder={t("projectCreate.selectTeamPlaceholder")} />
                  </SelectTrigger>
                  <SelectContent>
                    {manageableTeams.map((team) => (
                      <SelectItem
                        key={team.id}
                        value={team.id}
                        className="cursor-pointer text-[16px]"
                      >
                        {team.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
              {teamError && (
                <span className="mt-1 text-[13px] text-danger-5">{t("projectCreate.teamRequired")}</span>
              )}
            </div>
          )}
        </div>

        {/* Select model(s) — a single pool of everything available to you
            (catalog + your own keys / Custom LLMs, marked "(custom)"). The
            first picked is the project's active model; the rest are
            switchable from the project header. */}
        <div className="flex flex-col items-stretch md:items-center gap-4 w-full rounded-xl md:rounded-none bg-bg-white md:bg-transparent px-4 py-5 md:p-0">
          <h2 className="text-[18px] sm:text-[23px] font-bold text-text-1">{t("projectCreate.selectModel")}</h2>
          <p className="text-[14px] text-text-2 md:text-center leading-normal md:max-w-[600px]">
            {t("projectCreate.selectModelDesc")}
          </p>

          <div className="flex w-full max-w-[900px] flex-col items-center gap-3">
            {configuredModels.length === 0 ? (
              <div className="rounded-lg border border-border-2 bg-bg-1 px-4 py-4 text-center text-[14px] text-text-2">
                {t("projectCreate.noModels")}{" "}
                <Link
                  href="/teams?tab=models"
                  className="text-primary-6 hover:underline"
                >
                  {t("projectCreate.addModels")}
                </Link>
              </div>
            ) : (
              <>
                <div className="flex w-full flex-wrap justify-center gap-2.5">
                  {configuredModels.map((m) => {
                    const isSelected = selectedModelIds.includes(m.id);
                    return (
                      <button
                        key={m.id}
                        type="button"
                        onClick={() => toggleModel(m.id)}
                        title={m.id}
                        className={`flex w-[calc(50%-5px)] cursor-pointer flex-col items-start gap-1 rounded-lg p-4 text-left transition-colors sm:w-auto sm:min-w-[220px] sm:max-w-[260px] sm:flex-1 ${
                          isSelected
                            ? "border border-primary-6 bg-primary-1"
                            : "border border-transparent bg-bg-1 hover:border-border-3"
                        }`}
                      >
                        <span className="max-w-full truncate text-[14px] font-medium text-text-1">
                          {m.name}
                          {routingSuffix(m.routing)}
                        </span>
                        <span className="max-w-full truncate text-[11px] text-text-3">
                          {m.id}
                        </span>
                      </button>
                    );
                  })}
                </div>
                <p className="text-center text-[13px] text-text-3">
                  {t("projectCreate.modelsHint")}{" "}
                  <Link
                    href="/teams?tab=models"
                    className="text-primary-6 hover:underline"
                  >
                    {t("projectCreate.addModels")}
                  </Link>
                </p>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Bottom bar — Cancel + Create Project. Stretches to full-width
          buttons on mobile (matching Figma 4659:69874), keeps the
          fixed compact buttons on desktop. */}
      <div className="sticky bottom-0 flex items-center justify-between gap-3 border-t border-bg-1 bg-bg-white px-4 py-3 md:px-6 md:py-4">
        <Button
          variant="outline"
          className="h-[43px] flex-1 md:flex-none md:w-[97px] rounded-lg border-border-2 text-[16px] text-text-1 cursor-pointer"
          onClick={() => router.back()}
        >
          {t("common.cancel")}
        </Button>
        <Button
          className="h-[43px] md:h-10 flex-1 md:flex-none md:w-[174px] rounded-lg bg-primary-6 hover:bg-primary-7 text-[16px] text-white cursor-pointer"
          onClick={handleSubmit}
          disabled={mutation.isPending || selectedModelIds.length === 0}
        >
          {mutation.isPending ? t("projectCreate.creating") : t("projectCreate.title")}
        </Button>
      </div>
    </div>
  );
}
