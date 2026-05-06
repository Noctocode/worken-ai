"use client";

import { useEffect, useState } from "react";
import {
  Check,
  Info,
  Loader2,
  MoreVertical,
  Pencil,
  Plus,
  Trash2,
  UserX,
  X,
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Switch } from "@/components/ui/switch";
import { useAuth } from "@/components/providers";
import {
  deleteCompany,
  fetchCompany,
  fetchOrgUsers,
  updateCompany,
} from "@/lib/api";
import { formatBudgetInput, formatCurrency } from "@/lib/utils";

interface CompanyGuardrail {
  id: string;
  name: string;
  types: string[];
  severity: "high" | "medium" | "low";
  triggers: number;
  active: boolean;
}

// Guardrails on this tab still mirror the static design; the org-level
// guardrails BE isn't there yet, so they stay as DEMO_GUARDRAILS until
// that work lands. The Company card above is fully wired to /companies/current.
const DEMO_GUARDRAILS: CompanyGuardrail[] = [
  { id: "1", name: "Content Safety Filter", types: ["Content Safety", "Input"], severity: "high", triggers: 1247, active: true },
  { id: "2", name: "Content Safety Filter", types: ["Content Safety", "Input"], severity: "high", triggers: 1247, active: true },
  { id: "3", name: "Content Safety Filter", types: ["Content Safety", "Input"], severity: "high", triggers: 1247, active: true },
];

export function CompanyTab() {
  const { user: currentUser } = useAuth();
  const isAdmin = currentUser?.role === "admin";
  const queryClient = useQueryClient();

  const {
    data: company,
    isLoading,
    error,
  } = useQuery({ queryKey: ["company"], queryFn: fetchCompany });
  const { data: orgUsers = [] } = useQuery({
    queryKey: ["org-users"],
    queryFn: fetchOrgUsers,
  });

  // Edit mode mirrors the user/team detail pattern: the page is read-
  // only by default; admin clicks Pencil to flip into edit mode, which
  // stages local copies of name / contact email / budget. Cancel
  // discards the staged values; Confirm fires updateCompany. Delete
  // (Trash2) opens a confirmation dialog and resets the row to defaults.
  const [isEditing, setIsEditing] = useState(false);
  const [editName, setEditName] = useState("");
  const [editEmail, setEditEmail] = useState("");
  const [editBudget, setEditBudget] = useState("");
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);

  const [guardrails, setGuardrails] =
    useState<CompanyGuardrail[]>(DEMO_GUARDRAILS);
  const toggleGuardrail = (id: string) => {
    setGuardrails((prev) =>
      prev.map((g) => (g.id === id ? { ...g, active: !g.active } : g)),
    );
  };

  const updateMutation = useMutation({
    mutationFn: updateCompany,
  });
  const deleteMutation = useMutation({
    mutationFn: deleteCompany,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["company"] });
      toast.success("Company settings reset.");
      setConfirmDeleteOpen(false);
    },
    onError: (err: Error) => {
      toast.error(err.message || "Couldn't reset company.");
    },
  });

  const editing = isAdmin && isEditing;
  const isSaving = updateMutation.isPending;

  const enterEdit = () => {
    if (!company) return;
    setEditName(company.name);
    setEditEmail(company.contactEmail ?? "");
    setEditBudget(
      (company.monthlyBudgetCents / 100).toLocaleString("de-DE", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }),
    );
    setIsEditing(true);
  };

  const cancelEdit = () => {
    setIsEditing(false);
    setEditName("");
    setEditEmail("");
    setEditBudget("");
  };

  const confirmEdit = async () => {
    if (!company) return;
    const trimmedName = editName.trim();
    if (!trimmedName) {
      toast.error("Company name cannot be empty.");
      return;
    }
    const trimmedEmail = editEmail.trim();
    if (
      trimmedEmail.length > 0 &&
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)
    ) {
      toast.error("Contact email is not a valid address.");
      return;
    }
    const raw = editBudget.replace(/\./g, "").replace(",", ".");
    const parsed = parseFloat(raw);
    if (isNaN(parsed) || parsed < 0) {
      toast.error("Budget must be a non-negative number.");
      return;
    }

    const nameChanged = trimmedName !== company.name;
    const emailChanged = trimmedEmail !== (company.contactEmail ?? "");
    const budgetCents = Math.round(parsed * 100);
    const budgetChanged = budgetCents !== company.monthlyBudgetCents;
    if (!nameChanged && !emailChanged && !budgetChanged) {
      setIsEditing(false);
      return;
    }

    try {
      await updateMutation.mutateAsync({
        ...(nameChanged ? { name: trimmedName } : {}),
        ...(emailChanged ? { contactEmail: trimmedEmail || null } : {}),
        ...(budgetChanged ? { monthlyBudgetCents: budgetCents } : {}),
      });
      toast.success("Company updated.");
      queryClient.invalidateQueries({ queryKey: ["company"] });
      setIsEditing(false);
    } catch (err) {
      toast.error((err as Error).message || "Couldn't update company.");
    }
  };

  // Pencil/Trash2 in this card live inline (the Company tab doesn't
  // have its own appbar slot), but we still listen for the same
  // `company:edit` / `company:delete` window events so future appbar
  // wiring stays drop-in. MUST stay above the early returns so hooks
  // count is stable across loading transitions.
  useEffect(() => {
    const onEdit = () => enterEdit();
    const onDelete = () => setConfirmDeleteOpen(true);
    window.addEventListener("company:edit", onEdit);
    window.addEventListener("company:delete", onDelete);
    return () => {
      window.removeEventListener("company:edit", onEdit);
      window.removeEventListener("company:delete", onDelete);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [company]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="h-8 w-8 animate-spin text-text-3" />
      </div>
    );
  }

  if (error || !company) {
    return (
      <div className="flex items-center justify-center py-24">
        <p className="text-text-3">Failed to load company.</p>
      </div>
    );
  }

  const budget = company.monthlyBudgetCents / 100;
  const spent = company.spentCents / 100;
  const remaining = budget - spent;
  const projected = company.projectedCents / 100;
  const onTrack = projected <= budget;
  const pct = budget > 0 ? Math.min((spent / budget) * 100, 100) : 0;

  // Admin list comes from /users; owners of the org carry role='admin'.
  // Same source as the Users tab so the two views stay consistent.
  const admins = orgUsers.filter((u) => u.role === "admin");

  return (
    <div className="py-6 space-y-6">
      {/* Company card */}
      <div className="bg-bg-white rounded p-4 space-y-[30px]">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0 flex-1">
            <div className="flex h-20 w-20 shrink-0 items-center justify-center rounded-full bg-bg-3 text-text-3 text-2xl font-bold">
              {(company.name || "C").charAt(0).toUpperCase()}
            </div>
            <div className="space-y-3 flex-1 min-w-0">
              {editing ? (
                <input
                  type="text"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  placeholder="Company name"
                  disabled={isSaving}
                  className="w-full h-10 rounded border border-border-4 bg-transparent px-3 text-[18px] font-bold text-text-1 outline-none focus:border-ring focus:ring-[1px] focus:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-60"
                  autoFocus
                />
              ) : (
                <p className="text-[18px] font-bold text-text-1">
                  {company.name || "Unnamed company"}
                </p>
              )}
              {editing ? (
                <input
                  type="email"
                  value={editEmail}
                  onChange={(e) => setEditEmail(e.target.value)}
                  placeholder="Contact email (optional)"
                  disabled={isSaving}
                  className="w-full h-10 rounded border border-border-4 bg-transparent px-3 text-[16px] text-text-1 outline-none focus:border-ring focus:ring-[1px] focus:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-60"
                />
              ) : (
                <p className="text-[16px] text-text-1">
                  {company.contactEmail ?? (
                    <span className="text-text-3">No contact email</span>
                  )}
                </p>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {editing ? (
              <>
                <Button
                  variant="outline"
                  className="h-10 gap-2 border-border-2"
                  onClick={cancelEdit}
                  disabled={isSaving}
                >
                  <X className="h-4 w-4" />
                  Cancel
                </Button>
                <Button
                  className="h-10 gap-2 bg-success-7 text-white hover:bg-success-7/90"
                  onClick={confirmEdit}
                  disabled={isSaving}
                >
                  {isSaving ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Check className="h-4 w-4" strokeWidth={2.5} />
                  )}
                  Confirm
                </Button>
              </>
            ) : (
              isAdmin && (
                <>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 text-success-7 hover:text-success-7/80"
                    onClick={enterEdit}
                    title="Edit company"
                  >
                    <Pencil className="h-6 w-6" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 text-success-7 hover:text-success-7/80"
                    onClick={() => setConfirmDeleteOpen(true)}
                    title="Reset company settings"
                  >
                    <Trash2 className="h-6 w-6" />
                  </Button>
                </>
              )
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {/* Monthly Budget */}
          <div className="space-y-3">
            <p className="text-[18px] font-bold text-text-1">Monthly Budget</p>
            {editing ? (
              <div className="relative">
                <span className="absolute left-4 top-1/2 -translate-y-1/2 text-[16px] text-text-2">
                  $
                </span>
                <input
                  type="text"
                  inputMode="decimal"
                  value={editBudget}
                  onChange={(e) =>
                    setEditBudget(formatBudgetInput(e.target.value))
                  }
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      void confirmEdit();
                    } else if (e.key === "Escape") {
                      e.preventDefault();
                      cancelEdit();
                    }
                  }}
                  disabled={isSaving}
                  className="w-full h-[56px] rounded border border-border-4 bg-transparent pl-7 pr-4 text-[16px] text-text-1 outline-none focus:border-ring focus:ring-[1px] focus:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-60"
                />
              </div>
            ) : (
              <div className="flex h-[56px] items-center px-1 text-[16px] text-text-1">
                {budget > 0 ? (
                  <span>{formatCurrency(budget)}</span>
                ) : (
                  <span className="text-text-3">Not set</span>
                )}
              </div>
            )}
            {!editing && !isAdmin && (
              <p className="text-[12px] text-text-3">
                Only admins can change this — ask an admin to adjust the
                budget.
              </p>
            )}
          </div>

          {/* Spent / Remaining */}
          <div className="space-y-3">
            <p className="text-[18px] font-bold text-text-1">Spent / Remaining</p>
            <div className="flex items-center gap-3 h-[56px]">
              <span className="text-[16px] text-text-2">
                {formatCurrency(spent)} /{" "}
                {remaining > 0 ? formatCurrency(remaining) : formatCurrency(0)}
              </span>
              <div className="flex items-center h-[7px] w-[68px] shrink-0 rounded-full border border-border-4 overflow-hidden">
                <div
                  className={`h-full shrink-0 ${remaining < 0 ? "bg-danger-5" : "bg-success-2"}`}
                  style={{ width: `${pct}%` }}
                />
                <div className="h-full flex-1 bg-bg-white" />
              </div>
            </div>
          </div>

          {/* Projected */}
          <div className="space-y-3">
            <div className="flex items-center gap-3">
              <p className="text-[18px] font-bold text-text-1">Projected</p>
              <Info className="h-3.5 w-3.5 text-text-3" />
            </div>
            <div className="flex items-center gap-2.5 h-[56px]">
              <span className="text-[16px] text-text-1">{formatCurrency(projected)}</span>
              <span
                className={`rounded-lg px-2 py-1 text-[13px] ${
                  onTrack ? "bg-success-1 text-text-1" : "bg-bg-1 text-text-3"
                }`}
              >
                {onTrack ? "On track" : "Over Budget"}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Admins */}
      <div className="space-y-3">
        <p className="text-[18px] font-bold text-text-1">Admins</p>
        <div className="rounded overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[540px]">
              <thead>
                <tr>
                  <th className="bg-bg-white px-4 py-2 text-left align-middle text-[13px] font-normal text-text-2 w-[300px]">Name</th>
                  <th className="bg-bg-white px-4 py-2 text-left align-middle text-[13px] font-normal text-text-2">Email</th>
                  <th className="bg-bg-white px-4 py-2 text-center align-middle text-[13px] font-normal text-text-2 w-[93px]">Actions</th>
                </tr>
              </thead>
              <tbody>
                {admins.map((admin) => {
                  const display = admin.name ?? admin.email;
                  return (
                    <tr key={admin.id} className="h-14">
                      <td className="bg-bg-white px-4 align-middle w-[300px]">
                        <div className="flex items-center gap-2.5">
                          {admin.picture ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={admin.picture}
                              alt={display}
                              referrerPolicy="no-referrer"
                              className="h-6 w-6 rounded-full object-cover border border-border-2"
                            />
                          ) : (
                            <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-bg-3 text-[10px] font-semibold text-text-3">
                              {display.charAt(0).toUpperCase()}
                            </div>
                          )}
                          <span className="text-[16px] text-text-1 whitespace-nowrap">{display}</span>
                        </div>
                      </td>
                      <td className="bg-bg-white px-4 align-middle text-[16px] text-text-1 whitespace-nowrap">
                        {admin.email}
                      </td>
                      <td className="bg-bg-white px-4 align-middle w-[93px]">
                        <div className="flex justify-center">
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="icon" className="h-7 w-7 text-text-2 hover:text-text-1">
                                <MoreVertical className="h-5 w-5" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem className="gap-2 text-danger-6 focus:text-danger-6">
                                <UserX className="h-4 w-4" />
                                Remove admin
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {admins.length === 0 && (
                  <tr>
                    <td
                      colSpan={3}
                      className="bg-bg-white px-4 py-8 text-center text-[16px] text-text-3"
                    >
                      No admins yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Primary Guardrails */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <p className="text-[18px] font-bold text-text-1">Primary Guardrails</p>
          <Button variant="plusAction" className="rounded-lg w-[155px]">
            <Plus className="h-4 w-4 text-text-white" />
            Add Guardrail
          </Button>
        </div>
        <div className="bg-bg-white rounded overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[700px]">
              <thead>
                <tr>
                  <th className="bg-bg-white px-4 py-2 text-left align-middle text-[13px] font-normal text-text-2">Name</th>
                  <th className="bg-bg-white px-4 py-2 text-left align-middle text-[13px] font-normal text-text-2">Type</th>
                  <th className="bg-bg-white px-4 py-2 text-left align-middle text-[13px] font-normal text-text-2">Severity</th>
                  <th className="bg-bg-white px-4 py-2 text-left align-middle text-[13px] font-normal text-text-2">Triggers</th>
                  <th className="bg-bg-white px-4 py-2 text-left align-middle text-[13px] font-normal text-text-2 w-[167px]">Status</th>
                  <th className="bg-bg-white px-4 py-2 text-left align-middle text-[13px] font-normal text-text-2 w-[93px]">Actions</th>
                </tr>
              </thead>
              <tbody>
                {guardrails.map((g) => (
                  <tr key={g.id} className="h-14 border-b border-border-2">
                    <td className="px-4 align-middle">
                      <span className="text-[16px] text-text-1 whitespace-nowrap">{g.name}</span>
                    </td>
                    <td className="px-4 align-middle">
                      <div className="flex gap-2.5">
                        {g.types.map((t) => (
                          <span key={t} className="rounded-lg bg-bg-2 px-2 py-1 text-[13px] text-text-3 whitespace-nowrap">
                            {t}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td className="px-4 align-middle">
                      <span className="rounded-lg bg-bg-1 px-2 py-1 text-[13px] text-text-3">
                        {g.severity}
                      </span>
                    </td>
                    <td className="px-4 align-middle text-[16px] text-text-1">
                      {g.triggers.toLocaleString()}
                    </td>
                    <td className="px-4 align-middle w-[167px]">
                      <div className="flex items-center gap-2.5">
                        <Switch checked={g.active} onCheckedChange={() => toggleGuardrail(g.id)} />
                        <span className="text-[16px] text-text-1 whitespace-nowrap">{g.active ? "Active" : "Inactive"}</span>
                      </div>
                    </td>
                    <td className="px-4 align-middle w-[93px]">
                      <div className="flex justify-center">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-7 w-7 text-text-2 hover:text-text-1">
                              <MoreVertical className="h-5 w-5" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem className="gap-2">
                              <Pencil className="h-4 w-4" />
                              Edit
                            </DropdownMenuItem>
                            <DropdownMenuItem className="gap-2 text-danger-6 focus:text-danger-6">
                              <Trash2 className="h-4 w-4" />
                              Delete
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Reset confirmation. Trash2 doesn't drop the singleton row —
          companies.service.ts only clears the fields back to defaults
          so createdAt + audit history stay intact. */}
      <Dialog
        open={confirmDeleteOpen}
        onOpenChange={(open) => !open && setConfirmDeleteOpen(false)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reset company settings</DialogTitle>
            <DialogDescription>
              This clears the company name, contact email, and monthly budget
              back to defaults. Admins and team data are not affected.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              onClick={() => setConfirmDeleteOpen(false)}
              disabled={deleteMutation.isPending}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => deleteMutation.mutate()}
              disabled={deleteMutation.isPending}
            >
              {deleteMutation.isPending ? "Resetting..." : "Reset"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
