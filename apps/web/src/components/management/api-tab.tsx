"use client";

import { useState } from "react";
import { Copy, MoreVertical, Link2, Trash2, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface ApiKey {
  id: string;
  name: string;
  link: string;
  created: string;
  lastUsed: string;
}

const DEMO_KEYS: ApiKey[] = [
  { id: "1", name: "Test11", link: "sk-proj-xxxxxxxxxxxxxxxx", created: "Aug 5 2024", lastUsed: "Aug 5 2024" },
  { id: "2", name: "Test11", link: "sk-proj-xxxxxxxxxxxxxxxx", created: "Aug 5 2024", lastUsed: "Aug 5 2024" },
];

function truncateKey(key: string) {
  return key.slice(0, 10) + "...";
}

export function ApiTab() {
  const [linkName, setLinkName] = useState("");
  const [keys, setKeys] = useState<ApiKey[]>(DEMO_KEYS);
  const [copied, setCopied] = useState<string | null>(null);

  const handleGenerate = () => {
    if (!linkName.trim()) return;
    const newKey: ApiKey = {
      id: Date.now().toString(),
      name: linkName.trim(),
      link: "sk-proj-" + Math.random().toString(36).slice(2, 18),
      created: new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }),
      lastUsed: "—",
    };
    setKeys((prev) => [newKey, ...prev]);
    setLinkName("");
  };

  const handleCopy = (key: ApiKey) => {
    navigator.clipboard.writeText(key.link).catch(() => {});
    setCopied(key.id);
    setTimeout(() => setCopied(null), 1500);
  };

  const handleDelete = (id: string) => {
    setKeys((prev) => prev.filter((k) => k.id !== id));
  };

  return (
    <div className="py-5">
      {/* Header row */}
      <div className="flex items-center justify-between mb-5">
        <span className="text-[18px] font-bold text-black-900">API</span>
        <button className="text-[13px] text-primary-5 hover:underline">
          API Documentation
        </button>
      </div>

      {/* Generate API Link */}
      <div className="bg-white rounded-lg border border-bg-1 px-4 sm:px-6 py-5 mb-5">
        <p className="text-[14px] font-semibold text-black mb-3">Generate API Link</p>
        <p className="text-[12px] text-slate-500 mb-1">Link Name</p>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <Input
            placeholder="Type Link Name"
            value={linkName}
            onChange={(e) => setLinkName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleGenerate()}
            className="flex-1"
          />
          <Button
            onClick={handleGenerate}
            disabled={!linkName.trim()}
            className="shrink-0 gap-2 bg-primary-6 hover:bg-primary-6/90 text-white w-full sm:w-auto"
          >
            <Link2 className="h-4 w-4" />
            Generate Link
          </Button>
        </div>
      </div>

      {/* My Keys */}
      <div className="bg-white rounded-lg border border-bg-1 overflow-hidden">
        <div className="px-4 sm:px-6 py-4 border-b border-bg-1">
          <p className="text-[14px] font-semibold text-black">My Keys</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[580px]">
            <thead>
              <tr className="h-[33px] border-b border-bg-1">
                <th className="px-4 sm:px-6 text-left align-middle text-[13px] font-normal text-black-700">Name</th>
                <th className="px-4 text-left align-middle text-[13px] font-normal text-black-700">Link</th>
                <th className="px-4 text-left align-middle text-[13px] font-normal text-black-700">Created</th>
                <th className="px-4 text-left align-middle text-[13px] font-normal text-black-700">Last Used</th>
                <th className="px-4 text-right align-middle text-[13px] font-normal text-black-700">Action</th>
              </tr>
            </thead>
            <tbody>
              {keys.map((key) => (
                <tr key={key.id} className="h-14 border-b border-bg-1 last:border-0 transition-colors hover:bg-slate-50/50">
                  <td className="px-4 sm:px-6 align-middle text-[13px] font-medium text-black whitespace-nowrap">{key.name}</td>
                  <td className="px-4 align-middle">
                    <div className="flex items-center gap-2">
                      <span className="text-[13px] text-primary-5 whitespace-nowrap">{truncateKey(key.link)}</span>
                      <button
                        onClick={() => handleCopy(key)}
                        className="text-slate-400 hover:text-slate-600 transition-colors"
                        title="Copy key"
                      >
                        <Copy className="h-3.5 w-3.5" />
                      </button>
                      {copied === key.id && (
                        <span className="text-[11px] text-emerald-500">Copied!</span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 align-middle text-[13px] text-black whitespace-nowrap">{key.created}</td>
                  <td className="px-4 align-middle text-[13px] text-black whitespace-nowrap">{key.lastUsed}</td>
                  <td className="px-4 align-middle text-right">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" className="h-7 w-7 text-slate-400 hover:text-slate-600">
                          <MoreVertical className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem className="gap-2" onClick={() => handleCopy(key)}>
                          <Copy className="h-4 w-4" />
                          Copy key
                        </DropdownMenuItem>
                        <DropdownMenuItem className="gap-2">
                          <ExternalLink className="h-4 w-4" />
                          View usage
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          className="gap-2 text-red-600 focus:text-red-600"
                          onClick={() => handleDelete(key.id)}
                        >
                          <Trash2 className="h-4 w-4" />
                          Delete
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </td>
                </tr>
              ))}
              {keys.length === 0 && (
                <tr>
                  <td colSpan={5} className="py-12 text-center text-sm text-slate-400">
                    No API keys yet. Generate your first key above.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
