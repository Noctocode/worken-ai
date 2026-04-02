"use client";

import { useState } from "react";
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
import { createProject, fetchTeams } from "@/lib/api";
import { MODELS } from "@/lib/models";

const AGENTS = [
  { id: "general-assistant", label: "General Assistant", icon: Bot },
  { id: "business-development", label: "Business Development Specialist", icon: Briefcase },
  { id: "marketing-strategist", label: "Marketing Strategist", icon: Megaphone },
  { id: "customer-support", label: "Customer Support", icon: HeadphonesIcon },
  { id: "code-engineer", label: "Code Engineer", icon: Code },
  { id: "security-advisor", label: "Security Advisor", icon: Shield },
  { id: "sales-rep", label: "Sales Rep", icon: TrendingUp },
  { id: "hr", label: "HR", icon: Users },
  { id: "seo-specialist", label: "SEO Specialist", icon: Search },
  { id: "copywriter", label: "Copywriter", icon: PenTool },
  { id: "automation-engineer", label: "Automation Engineer", icon: Settings },
  { id: "lawyer", label: "Lawyer", icon: Scale },
] as const;

export default function CreateProjectPage() {
  const router = useRouter();
  const queryClient = useQueryClient();

  const [projectType, setProjectType] = useState<"personal" | "team">("personal");
  const [selectedAgent, setSelectedAgent] = useState<string>("general-assistant");
  const [selectedTeamId, setSelectedTeamId] = useState<string>("");
  const [memberChips, setMemberChips] = useState<string[]>([]);
  const [memberInput, setMemberInput] = useState("");

  const { data: teams } = useQuery({
    queryKey: ["teams"],
    queryFn: fetchTeams,
    enabled: projectType === "team",
  });

  const mutation = useMutation({
    mutationFn: createProject,
    onSuccess: (project) => {
      queryClient.invalidateQueries({ queryKey: ["projects"] });
      router.push(`/projects/${project.id}`);
    },
  });

  const handleAddChip = (value: string) => {
    const trimmed = value.trim();
    if (trimmed && !memberChips.includes(trimmed)) {
      setMemberChips((prev) => [...prev, trimmed]);
    }
    setMemberInput("");
  };

  const handleSubmit = () => {
    const agent = AGENTS.find((a) => a.id === selectedAgent);
    if (!agent) return;
    mutation.mutate({
      name: agent.label,
      description: `${agent.label} project`,
      model: MODELS[0].id,
      teamId: projectType === "team" && selectedTeamId ? selectedTeamId : undefined,
    });
  };

  return (
    <div className="flex flex-col min-h-full -mx-6 -mb-6">
      {/* Scrollable content */}
      <div className="flex-1 overflow-auto">
        <div className="flex flex-col items-center gap-8 py-24 px-6">
          {/* Select Project Type */}
          <div className="flex flex-col items-center gap-4 w-full max-w-[600px]">
            <h2 className="text-[23px] font-bold text-text-1">Select Project Type</h2>

            <div className="flex rounded-lg border border-border-3 overflow-hidden">
              <button
                onClick={() => setProjectType("personal")}
                className={`flex items-center justify-center gap-2 w-[150px] py-3 text-[16px] transition-colors ${
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
                className={`flex items-center justify-center gap-2 w-[150px] py-3 text-[16px] transition-colors ${
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

            {/* Team members input */}
            {projectType === "team" && (
              <div className="w-full space-y-3">
                {teams && teams.length > 0 && (
                  <Select value={selectedTeamId} onValueChange={setSelectedTeamId}>
                    <SelectTrigger className="border-border-2 text-text-1">
                      <SelectValue placeholder="Select a team" />
                    </SelectTrigger>
                    <SelectContent>
                      {teams.map((t) => (
                        <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}

                <div className="flex items-center gap-2 rounded-xl border border-border-2 px-3.5 py-3">
                  <div className="flex flex-1 flex-wrap items-center gap-2">
                    {memberChips.map((chip) => (
                      <span key={chip} className="flex items-center gap-0.5 rounded bg-bg-1 pl-2 pr-0.5 py-0.5 text-[12px] font-medium text-text-1">
                        {chip}
                        <button onClick={() => setMemberChips((prev) => prev.filter((c) => c !== chip))} className="p-1 rounded hover:bg-bg-3">
                          <X className="h-2 w-2" />
                        </button>
                      </span>
                    ))}
                    <input
                      value={memberInput}
                      onChange={(e) => setMemberInput(e.target.value)}
                      onKeyDown={(e) => {
                        if ((e.key === "Enter" || e.key === ",") && memberInput.trim()) {
                          e.preventDefault();
                          handleAddChip(memberInput);
                        }
                      }}
                      placeholder={memberChips.length === 0 ? "Add members..." : ""}
                      className="flex-1 min-w-[100px] bg-transparent text-[14px] text-text-1 outline-none placeholder:text-text-3"
                    />
                  </div>
                  <span className="flex items-center gap-1 text-[13px] text-text-1 whitespace-nowrap">
                    Can Edit
                    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" className="text-text-3"><path d="M3.5 5.25L7 8.75L10.5 5.25" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
                  </span>
                </div>
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
                return (
                  <button
                    key={agent.id}
                    onClick={() => setSelectedAgent(agent.id)}
                    className={`flex flex-col items-center gap-2.5 p-4 min-w-[200px] flex-1 max-w-[220px] transition-colors ${
                      isSelected
                        ? "bg-primary-1 border border-primary-6"
                        : "bg-bg-1 border border-transparent hover:border-border-3"
                    }`}
                  >
                    <div className="flex h-[60px] w-[60px] items-center justify-center rounded-xl bg-[rgba(60,126,255,0.2)]">
                      <Icon className="h-10 w-10 text-primary-6" />
                    </div>
                    <span className="text-[13px] text-text-2 whitespace-nowrap">{agent.label}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {/* Bottom bar */}
      <div className="sticky bottom-0 flex items-center justify-between border-t border-border-2 bg-bg-white px-6 py-4">
        <Button
          variant="outline"
          className="h-[43px] w-[97px] rounded-lg border-border-2 text-[16px] text-text-1"
          onClick={() => router.back()}
        >
          Cancel
        </Button>
        <Button
          className="h-10 w-[174px] rounded-lg bg-primary-6 hover:bg-primary-7 text-[16px] text-white"
          onClick={handleSubmit}
          disabled={mutation.isPending || !selectedAgent}
        >
          {mutation.isPending ? "Creating..." : "Create Project"}
        </Button>
      </div>
    </div>
  );
}
