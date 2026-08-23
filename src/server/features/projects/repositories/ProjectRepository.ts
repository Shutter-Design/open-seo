import {
  and,
  asc,
  count,
  desc,
  eq,
  inArray,
  isNotNull,
  isNull,
  sql,
} from "drizzle-orm";
import { db } from "@/db";
import { runBatch } from "@/db/runBatch";
import { projectDomains, projects } from "@/db/schema";
import { AppError } from "@/server/lib/errors";

async function listProjects(organizationId: string) {
  return db.query.projects.findMany({
    where: and(
      eq(projects.organizationId, organizationId),
      isNull(projects.archivedAt),
    ),
    orderBy: [desc(projects.createdAt), desc(projects.id)],
  });
}

async function countProjects(organizationId: string) {
  const [row] = await db
    .select({ value: count() })
    .from(projects)
    .where(
      and(
        eq(projects.organizationId, organizationId),
        isNull(projects.archivedAt),
      ),
    );
  return row?.value ?? 0;
}

async function listDomainsForProjects(projectIds: string[]) {
  if (projectIds.length === 0) return [];
  return db
    .select()
    .from(projectDomains)
    .where(inArray(projectDomains.projectId, projectIds))
    .orderBy(asc(projectDomains.createdAt), asc(projectDomains.domain));
}

async function listDomainsForProject(projectId: string) {
  return listDomainsForProjects([projectId]);
}

async function getProjectForOrganization(
  projectId: string,
  organizationId: string,
) {
  const [project] = await db
    .select()
    .from(projects)
    .where(
      and(
        eq(projects.id, projectId),
        eq(projects.organizationId, organizationId),
        isNull(projects.archivedAt),
      ),
    )
    .limit(1);
  return project ?? null;
}

// Look up a project by id alone (no org scoping). Only for trusted server
// contexts that have already authorized access another way — e.g. the
// onboarding chat Durable Object, whose connections are authorized in the
// Worker before they reach the DO, and which derives its org from the project.
async function getProjectById(projectId: string) {
  const [project] = await db
    .select()
    .from(projects)
    .where(and(eq(projects.id, projectId), isNull(projects.archivedAt)))
    .limit(1);
  return project ?? null;
}

async function createProject(
  organizationId: string,
  name: string,
  domain?: string,
  // Omitted keeps the column defaults.
  market?: { locationCode: number; languageCode: string },
) {
  const id = crypto.randomUUID();
  await runBatch((tx) => [
    tx.insert(projects).values({ id, organizationId, name, domain, ...market }),
    ...(domain
      ? [tx.insert(projectDomains).values({ projectId: id, domain })]
      : []),
  ]);
  const [row] = await db
    .select()
    .from(projects)
    .where(eq(projects.id, id))
    .limit(1);
  if (!row) {
    throw new Error("Failed to create project");
  }
  return row;
}

async function updateProject(
  projectId: string,
  organizationId: string,
  input: {
    name: string;
    domain?: string;
    // Omitted leaves the market columns untouched.
    market?: { locationCode: number; languageCode: string };
  },
) {
  const [row] = await db
    .update(projects)
    .set({ name: input.name, domain: input.domain ?? null, ...input.market })
    .where(
      and(
        eq(projects.id, projectId),
        eq(projects.organizationId, organizationId),
        isNull(projects.archivedAt),
      ),
    )
    .returning();

  if (!row) {
    throw new AppError("NOT_FOUND");
  }

  return row;
}

// Writes only the domain column, for the dashboard's inline domain input.
async function updateProjectDomain(
  projectId: string,
  organizationId: string,
  domain: string,
) {
  const [row] = await db
    .update(projects)
    .set({ domain })
    .where(
      and(
        eq(projects.id, projectId),
        eq(projects.organizationId, organizationId),
        isNull(projects.archivedAt),
      ),
    )
    .returning();

  if (!row) {
    throw new AppError("NOT_FOUND");
  }

  return row;
}

async function replaceProjectDomains(
  projectId: string,
  organizationId: string,
  domains: string[],
  primaryDomain: string | null,
) {
  await runBatch((tx) => [
    tx
      .update(projects)
      .set({ domain: primaryDomain })
      .where(
        and(
          eq(projects.id, projectId),
          eq(projects.organizationId, organizationId),
          isNull(projects.archivedAt),
        ),
      ),
    tx.delete(projectDomains).where(eq(projectDomains.projectId, projectId)),
    ...domains.map((domain) =>
      tx.insert(projectDomains).values({ projectId, domain }),
    ),
  ]);

  const [row] = await db
    .select()
    .from(projects)
    .where(
      and(
        eq(projects.id, projectId),
        eq(projects.organizationId, organizationId),
        isNull(projects.archivedAt),
      ),
    )
    .limit(1);
  if (!row) {
    throw new AppError("NOT_FOUND");
  }
  return row;
}

// Writes only the market columns. Onboarding sets the project's market before
// the user has named the project or picked a domain, so it must not go through
// updateProject, whose `domain: input.domain ?? null` would clear the domain.
async function updateProjectMarket(
  projectId: string,
  organizationId: string,
  market: { locationCode: number; languageCode: string },
) {
  const [row] = await db
    .update(projects)
    .set(market)
    .where(
      and(
        eq(projects.id, projectId),
        eq(projects.organizationId, organizationId),
        isNull(projects.archivedAt),
      ),
    )
    .returning();

  if (!row) {
    throw new AppError("NOT_FOUND");
  }

  return row;
}

async function tryCreateDefaultProject(organizationId: string) {
  const id = crypto.randomUUID();
  const inserted = await db
    .insert(projects)
    .values({
      id,
      organizationId,
      name: "Default",
      domain: null,
    })
    .onConflictDoNothing()
    .returning({ id: projects.id });
  return inserted.length > 0 ? id : null;
}

async function listArchivedProjects(organizationId: string) {
  return db.query.projects.findMany({
    where: and(
      eq(projects.organizationId, organizationId),
      isNotNull(projects.archivedAt),
    ),
    orderBy: [desc(projects.archivedAt), desc(projects.id)],
  });
}

async function restoreProject(projectId: string, organizationId: string) {
  const [row] = await db
    .update(projects)
    .set({ archivedAt: null })
    .where(
      and(
        eq(projects.id, projectId),
        eq(projects.organizationId, organizationId),
        isNotNull(projects.archivedAt),
      ),
    )
    .returning({ id: projects.id });

  if (!row) {
    throw new AppError("NOT_FOUND");
  }
}

async function archiveProject(projectId: string, organizationId: string) {
  const [row] = await db
    .update(projects)
    .set({ archivedAt: sql`(current_timestamp)` })
    .where(
      and(
        eq(projects.id, projectId),
        eq(projects.organizationId, organizationId),
        isNull(projects.archivedAt),
      ),
    )
    .returning({ id: projects.id });

  if (!row) {
    throw new AppError("NOT_FOUND");
  }
}

export const ProjectRepository = {
  listProjects,
  listArchivedProjects,
  countProjects,
  listDomainsForProjects,
  listDomainsForProject,
  getProjectForOrganization,
  getProjectById,
  createProject,
  updateProject,
  updateProjectDomain,
  replaceProjectDomains,
  updateProjectMarket,
  tryCreateDefaultProject,
  archiveProject,
  restoreProject,
} as const;
