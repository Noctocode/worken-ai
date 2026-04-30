"use client";

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
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { createProject, fetchTeams } from "@/lib/api";
import { useAvailableModels } from "@/lib/hooks/use-available-models";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { cloneElement, isValidElement, useState } from "react";

export function CreateProjectDialog({
  children,
}: {
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [model, setModel] = useState("");
  const [teamId, setTeamId] = useState<string>("personal");

  const queryClient = useQueryClient();
  const { models, isLoading: modelsLoading } = useAvailableModels();

  const { data: teams } = useQuery({
    queryKey: ["teams"],
    queryFn: fetchTeams,
    enabled: open,
  });

  const mutation = useMutation({
    mutationFn: createProject,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["projects"] });
      setName("");
      setDescription("");
      setModel("");
      setTeamId("personal");
      setOpen(false);
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !model) return;
    mutation.mutate({
      name: name.trim(),
      description: description.trim() || undefined,
      model,
      teamId: teamId === "personal" ? undefined : teamId,
    });
  };

  // Instead of DialogTrigger (which renders aria-controls with random Radix IDs
  // causing hydration mismatch), we clone the child element with an onClick handler.
  const trigger = isValidElement(children)
    ? cloneElement(children as React.ReactElement<{ onClick?: () => void }>, {
        onClick: () => setOpen(true),
      })
    : children;

  return (
    <>
      {trigger}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create New Project</DialogTitle>
            <DialogDescription>
              Start a new AI project with your preferred model.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="project-name">Name</Label>
              <Input
                id="project-name"
                placeholder="My AI Project"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="project-description">Description</Label>
              <Textarea
                id="project-description"
                placeholder="What is this project about?"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={3}
              />
            </div>
            <div className="space-y-2">
              <Label>Model</Label>
              <Select value={model} onValueChange={setModel} required>
                <SelectTrigger className="w-full">
                  <SelectValue
                    placeholder={
                      modelsLoading
                        ? "Loading models…"
                        : models.length === 0
                          ? "No models enabled — ask an admin"
                          : "Select a model"
                    }
                  />
                </SelectTrigger>
                <SelectContent>
                  {models.map((m) => (
                    <SelectItem key={m.id} value={m.id}>
                      {m.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {teams && teams.length > 0 && (
              <div className="space-y-2">
                <Label>Workspace</Label>
                <Select value={teamId} onValueChange={setTeamId}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="personal">Personal</SelectItem>
                    {teams.map((team) => (
                      <SelectItem key={team.id} value={team.id}>
                        {team.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <DialogFooter>
              <Button
                type="submit"
                disabled={mutation.isPending || !name.trim() || !model}
              >
                {mutation.isPending ? "Creating..." : "Create Project"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}