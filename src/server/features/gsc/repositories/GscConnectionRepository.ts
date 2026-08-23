import { and, asc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { gscConnections } from "@/db/schema";

export type GscConnection = typeof gscConnections.$inferSelect;

async function getByProjectId(
  projectId: string,
): Promise<GscConnection | null> {
  const rows = await db
    .select()
    .from(gscConnections)
    .where(eq(gscConnections.projectId, projectId))
    .orderBy(asc(gscConnections.createdAt))
    .limit(1);
  return rows[0] ?? null;
}

async function getByProjectDomain(
  projectId: string,
  domain: string,
): Promise<GscConnection | null> {
  const rows = await db
    .select()
    .from(gscConnections)
    .where(
      and(
        eq(gscConnections.projectId, projectId),
        eq(gscConnections.domain, domain),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

async function listByProjectId(projectId: string): Promise<GscConnection[]> {
  return db
    .select()
    .from(gscConnections)
    .where(eq(gscConnections.projectId, projectId))
    .orderBy(asc(gscConnections.createdAt));
}

async function upsert(input: {
  projectId: string;
  organizationId: string;
  siteUrl: string;
  domain: string;
  connectedByUserId: string;
  gscAccountId: string;
  connectedAccountEmail: string | null;
}): Promise<GscConnection> {
  const [row] = await db
    .insert(gscConnections)
    .values({ id: crypto.randomUUID(), ...input })
    .onConflictDoUpdate({
      target: [gscConnections.projectId, gscConnections.domain],
      set: {
        siteUrl: input.siteUrl,
        organizationId: input.organizationId,
        connectedByUserId: input.connectedByUserId,
        gscAccountId: input.gscAccountId,
        connectedAccountEmail: sql`coalesce(${input.connectedAccountEmail}, ${gscConnections.connectedAccountEmail})`,
        updatedAt: sql`(current_timestamp)`,
      },
    })
    .returning();
  if (!row) {
    throw new Error("Failed to upsert gsc_connection");
  }
  return row;
}

async function deleteByProjectDomain(
  projectId: string,
  domain: string,
): Promise<void> {
  await db
    .delete(gscConnections)
    .where(
      and(
        eq(gscConnections.projectId, projectId),
        eq(gscConnections.domain, domain),
      ),
    );
}

async function existsForConnectorAccount(
  userId: string,
  gscAccountId: string,
): Promise<boolean> {
  const rows = await db
    .select({ id: gscConnections.id })
    .from(gscConnections)
    .where(
      and(
        eq(gscConnections.connectedByUserId, userId),
        eq(gscConnections.gscAccountId, gscAccountId),
      ),
    )
    .limit(1);
  return rows.length > 0;
}

export const GscConnectionRepository = {
  getByProjectId,
  getByProjectDomain,
  listByProjectId,
  upsert,
  deleteByProjectDomain,
  existsForConnectorAccount,
};
