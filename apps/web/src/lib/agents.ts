import {
  Bot,
  Briefcase,
  Code,
  HeadphonesIcon,
  Megaphone,
  PenTool,
  Scale,
  Search,
  Settings,
  Shield,
  TrendingUp,
  Users,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

export interface AgentPreset {
  id: string;
  label: string;
  icon: LucideIcon;
  /** Default model the agent maps to. Picker resolves this against the
   *  catalog at render time and falls back to the first available model
   *  when the preferred slug isn't surfaced. */
  model: string;
}

export const AGENTS: readonly AgentPreset[] = [
  {
    id: "general-assistant",
    label: "General Assistant",
    icon: Bot,
    model: "anthropic/claude-opus-4.6-fast",
  },
  {
    id: "business-development",
    label: "Business Development Specialist",
    icon: Briefcase,
    model: "openai/gpt-5.5",
  },
  {
    id: "marketing-strategist",
    label: "Marketing Strategist",
    icon: Megaphone,
    model: "anthropic/claude-opus-4.7",
  },
  {
    id: "customer-support",
    label: "Customer Support",
    icon: HeadphonesIcon,
    model: "openai/gpt-5.4-mini",
  },
  {
    id: "code-engineer",
    label: "Code Engineer",
    icon: Code,
    model: "anthropic/claude-opus-4.7",
  },
  {
    id: "security-advisor",
    label: "Security Advisor",
    icon: Shield,
    model: "anthropic/claude-opus-4.7",
  },
  {
    id: "sales-rep",
    label: "Sales Rep",
    icon: TrendingUp,
    model: "openai/gpt-5.5",
  },
  {
    id: "hr",
    label: "HR",
    icon: Users,
    model: "anthropic/claude-opus-4.6-fast",
  },
  {
    id: "seo-specialist",
    label: "SEO Specialist",
    icon: Search,
    model: "openai/gpt-5.5",
  },
  {
    id: "copywriter",
    label: "Copywriter",
    icon: PenTool,
    model: "anthropic/claude-opus-4.7",
  },
  {
    id: "automation-engineer",
    label: "Automation Engineer",
    icon: Settings,
    model: "deepseek/deepseek-r1",
  },
  {
    id: "lawyer",
    label: "Lawyer",
    icon: Scale,
    model: "anthropic/claude-opus-4.7",
  },
];
