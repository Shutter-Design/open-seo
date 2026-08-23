import * as React from "react";
import { useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ProjectMarketFields } from "@/client/features/projects/ProjectMarketFields";
import { getStandardErrorMessage } from "@/client/lib/error-messages";
import {
  clearLastProjectId,
  getLastProjectId,
} from "@/client/lib/active-project";
import {
  archiveProject,
  getProjects,
  setProjectDomains,
  updateProject,
} from "@/serverFunctions/projects";
import type { ProjectSummary } from "./types";

export function ProjectGeneralSettings({ projectId }: { projectId: string }) {
  const projectsQuery = useQuery({
    queryKey: ["projects"],
    queryFn: () => getProjects(),
  });
  const projects = projectsQuery.data ?? [];
  const project = projects.find((entry) => entry.id === projectId) ?? null;

  if (!project) {
    return (
      <div className="flex justify-center py-10">
        <span className="loading loading-spinner loading-md" />
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* key resets the form's local state when switching between projects */}
      <GeneralSection key={project.id} project={project} />
      <DomainsSection project={project} />
      <DangerSection project={project} canArchive={projects.length > 1} />
    </div>
  );
}

function GeneralSection({ project }: { project: ProjectSummary }) {
  const queryClient = useQueryClient();
  const [name, setName] = React.useState(project.name);
  const [market, setMarket] = React.useState({
    locationCode: project.locationCode,
    languageCode: project.languageCode,
  });

  const updateMutation = useMutation({
    mutationFn: () =>
      updateProject({
        data: {
          projectId: project.id,
          name: name.trim(),
          // updateProject historically clears an omitted domain, so preserve
          // the primary domain while this form edits only name and market.
          domain: project.domain ?? undefined,
          ...market,
        },
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["projects"] });
      toast.success("Project updated");
    },
    onError: (error) =>
      toast.error(getStandardErrorMessage(error, "Failed to update project")),
  });

  const isDirty =
    name.trim() !== project.name ||
    market.locationCode !== project.locationCode ||
    market.languageCode !== project.languageCode;

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    if (updateMutation.isPending) return;
    if (!name.trim()) {
      toast.error("Project name is required");
      return;
    }
    updateMutation.mutate();
  };

  return (
    <section className="space-y-3">
      <h2 className="text-sm font-medium text-base-content/50">General</h2>
      <form onSubmit={handleSubmit} className="space-y-4">
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="font-medium">Name</span>
          <input
            type="text"
            value={name}
            onChange={(event) => setName(event.target.value)}
            maxLength={120}
            className="input input-bordered w-full"
          />
        </label>

        <div className="flex flex-col gap-1.5">
          <ProjectMarketFields value={market} onChange={setMarket} />
          <span className="text-xs text-base-content/50">
            Keyword, SERP, and domain data uses this country and language unless
            a call asks for a different one.
          </span>
        </div>

        <div className="flex justify-end">
          <button
            type="submit"
            className="btn btn-primary btn-sm"
            disabled={updateMutation.isPending || !isDirty}
          >
            Save changes
          </button>
        </div>
      </form>
    </section>
  );
}

function DomainsSection({ project }: { project: ProjectSummary }) {
  const queryClient = useQueryClient();
  const [draft, setDraft] = React.useState("");
  const saveMutation = useMutation({
    mutationFn: (input: { domains: string[]; primaryDomain?: string }) =>
      setProjectDomains({
        data: { projectId: project.id, ...input },
      }),
    onSuccess: async () => {
      setDraft("");
      await queryClient.invalidateQueries({ queryKey: ["projects"] });
      toast.success("Domains saved");
    },
    onError: (error) =>
      toast.error(getStandardErrorMessage(error, "Failed to save domains")),
  });

  const addDomain = () => {
    const nextDomain = draft.trim();
    if (!nextDomain) return;
    if (project.domains.includes(nextDomain.toLowerCase())) {
      toast.error("That domain is already in this profile");
      return;
    }
    saveMutation.mutate({
      domains: [...project.domains, nextDomain],
      primaryDomain: project.domain ?? nextDomain,
    });
  };

  const removeDomain = (domain: string) => {
    const domains = project.domains.filter((entry) => entry !== domain);
    saveMutation.mutate({
      domains,
      primaryDomain:
        project.domain === domain ? domains[0] : (project.domain ?? undefined),
    });
  };

  return (
    <section className="space-y-3 border-t border-base-300 pt-8">
      <div className="space-y-1">
        <h2 className="text-sm font-medium text-base-content/50">Domains</h2>
        <p className="text-sm text-base-content/60">
          Add every site you want in this profile. Search Console totals combine
          their connected properties.
        </p>
      </div>

      <div className="space-y-2">
        {project.domains.length === 0 ? (
          <p className="text-sm text-base-content/50">No domains added yet.</p>
        ) : (
          project.domains.map((domain) => (
            <div
              key={domain}
              className="flex items-center justify-between gap-3 rounded-lg border border-base-300 bg-base-200/30 px-3 py-2"
            >
              <div className="min-w-0">
                <p className="truncate font-mono text-sm">{domain}</p>
                {project.domain === domain ? (
                  <p className="text-xs text-base-content/50">Primary domain</p>
                ) : null}
              </div>
              <div className="flex shrink-0 items-center gap-1">
                {project.domain !== domain ? (
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={() =>
                      saveMutation.mutate({
                        domains: project.domains,
                        primaryDomain: domain,
                      })
                    }
                    disabled={saveMutation.isPending}
                  >
                    Make primary
                  </button>
                ) : null}
                <button
                  type="button"
                  className="btn btn-ghost btn-sm text-error hover:bg-error/10"
                  onClick={() => removeDomain(domain)}
                  disabled={saveMutation.isPending}
                >
                  Remove
                </button>
              </div>
            </div>
          ))
        )}
      </div>

      <div className="flex flex-col gap-2 sm:flex-row">
        <input
          type="text"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              addDomain();
            }
          }}
          placeholder="example.com"
          maxLength={255}
          className="input input-bordered w-full"
        />
        <button
          type="button"
          className="btn btn-outline shrink-0"
          onClick={addDomain}
          disabled={saveMutation.isPending || !draft.trim()}
        >
          Add domain
        </button>
      </div>
    </section>
  );
}

function DangerSection({
  project,
  canArchive,
}: {
  project: ProjectSummary;
  canArchive: boolean;
}) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [confirming, setConfirming] = React.useState(false);

  const archiveMutation = useMutation({
    mutationFn: () => archiveProject({ data: { projectId: project.id } }),
    onSuccess: async () => {
      if (getLastProjectId() === project.id) clearLastProjectId();
      await queryClient.invalidateQueries({ queryKey: ["projects"] });
      toast.success("Project archived");
      // Re-resolve to a remaining project via the landing redirect.
      void navigate({ to: "/" });
    },
    onError: (error) =>
      toast.error(getStandardErrorMessage(error, "Failed to archive project")),
  });

  return (
    <section className="space-y-3 border-t border-base-300 pt-8">
      <h2 className="text-sm font-medium text-base-content/50">
        Archive project
      </h2>

      {confirming ? (
        <div className="space-y-3">
          <p className="text-sm text-base-content/70">
            Archiving{" "}
            <span className="font-medium text-base-content">
              {project.name}
            </span>{" "}
            removes it from your workspace and stops its scheduled rank
            tracking. You can restore it later from the Projects page.
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              className="btn btn-error btn-sm"
              onClick={() => archiveMutation.mutate()}
              disabled={archiveMutation.isPending}
            >
              Yes, archive project
            </button>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => setConfirming(false)}
              disabled={archiveMutation.isPending}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="flex items-center justify-between gap-4">
          <p className="text-sm text-base-content/60">
            {canArchive
              ? "Archive this project to remove it from your workspace."
              : "You can't archive your only project."}
          </p>
          <button
            type="button"
            className="btn btn-outline btn-error btn-sm shrink-0"
            onClick={() => setConfirming(true)}
            disabled={!canArchive}
          >
            Archive project
          </button>
        </div>
      )}
    </section>
  );
}
