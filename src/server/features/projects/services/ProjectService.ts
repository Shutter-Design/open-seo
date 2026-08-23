import {
  archiveProject,
  createProject,
  getProjectForOrganization,
  listArchivedProjects,
  listProjects,
  listProjectsEnsuringOne,
  restoreProject,
  setProjectDomain,
  setProjectDomains,
  setProjectMarket,
  updateProject,
} from "@/server/features/projects/services/projects";

export const ProjectService = {
  listProjects,
  listProjectsEnsuringOne,
  createProject,
  updateProject,
  setProjectDomain,
  setProjectDomains,
  setProjectMarket,
  archiveProject,
  restoreProject,
  listArchivedProjects,
  getProjectForOrganization,
} as const;
