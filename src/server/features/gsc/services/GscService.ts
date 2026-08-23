import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { account } from "@/db/schema";
import { GSC_OAUTH_PROVIDER_ID } from "@/shared/gsc";
import { AppError } from "@/server/lib/errors";
import {
  createGscClient,
  type GscSite,
  type UrlInspectionResult,
} from "@/server/lib/gscClient";
import {
  GscApiError,
  GscNotConnectedError,
  GscTokenError,
} from "@/server/lib/gscErrors";
export { GscNotConnectedError } from "@/server/lib/gscErrors";
import {
  buildSearchAnalyticsRequest,
  type GscPerformanceInput,
} from "@/server/features/gsc/searchAnalytics";
import {
  GscConnectionRepository,
  type GscConnection,
} from "@/server/features/gsc/repositories/GscConnectionRepository";
import { ProjectRepository } from "@/server/features/projects/repositories/ProjectRepository";
import { normalizeBacklinksTarget } from "@/server/lib/dataforseoBacklinksTarget";
import { mergeSearchAnalyticsRows } from "@/server/features/gsc/searchPerformanceReport";
import type {
  GscSearchAnalyticsRequest,
  GscSearchAnalyticsRow,
} from "@/server/lib/gscClient";

const SITE_UNVERIFIED_PERMISSION = "siteUnverifiedUser";

type GscPerformanceResult = {
  // Existing callers display this as the data source. A comma-separated list
  // makes an aggregated report explicit without changing their API contract.
  siteUrl: string;
  siteUrls: string[];
  request: GscSearchAnalyticsRequest;
  rows: GscSearchAnalyticsRow[];
};

type GscSiteListResult = {
  accounts: Array<{
    accountId: string;
    email: string | null;
    requiresReconnect: boolean;
    sites: GscSite[];
  }>;
};

/** Thrown when a project has no connected GSC property. */
async function getConnection(projectId: string): Promise<GscConnection | null> {
  return GscConnectionRepository.getByProjectId(projectId);
}

async function getConnections(projectId: string): Promise<GscConnection[]> {
  return GscConnectionRepository.listByProjectId(projectId);
}

function getPropertyDomain(siteUrl: string): string {
  const rawDomain = siteUrl.startsWith("sc-domain:")
    ? siteUrl.slice("sc-domain:".length)
    : new URL(siteUrl).hostname;
  try {
    return normalizeBacklinksTarget(rawDomain, { scope: "domain" }).apiTarget;
  } catch {
    throw new AppError(
      "VALIDATION_ERROR",
      "That Search Console property does not have a valid domain.",
    );
  }
}

/** Whether this user has linked a google-search-console grant (regardless of
 *  whether they've picked a property yet). Drives the connect-vs-pick UI. */
async function userHasGrant(userId: string): Promise<boolean> {
  const rows = await db
    .select({ id: account.id })
    .from(account)
    .where(
      and(
        eq(account.userId, userId),
        eq(account.providerId, GSC_OAUTH_PROVIDER_ID),
      ),
    )
    .limit(1);
  return rows.length > 0;
}

async function listGrantsForUser(userId: string) {
  return db
    .select({ id: account.id, accountId: account.accountId })
    .from(account)
    .where(
      and(
        eq(account.userId, userId),
        eq(account.providerId, GSC_OAUTH_PROVIDER_ID),
      ),
    );
}

/** Expected ways a stored grant fails to reach Search Console: no token could be
 *  minted (refresh token revoked or expired), or Google rejected the call
 *  (401/403). These surface a reconnect prompt without fault logging. */
export function isExpectedGrantFailure(error: unknown): boolean {
  if (error instanceof GscTokenError) return true;
  return (
    error instanceof GscApiError &&
    (error.status === 401 || error.status === 403)
  );
}

async function listSitesForUserWithGrantStatus(
  userId: string,
): Promise<GscSiteListResult> {
  const grants = await listGrantsForUser(userId);
  const accounts = await Promise.all(
    grants.map(async (grant) => {
      const client = createGscClient({
        userId,
        gscAccountId: grant.accountId,
      });

      try {
        const sites = await client.listSites();
        let email: string | null = null;
        try {
          email = await client.getUserInfoEmail();
        } catch {
          email = null;
        }
        return {
          accountId: grant.accountId,
          email,
          requiresReconnect: false,
          sites,
        };
      } catch (error) {
        if (!isExpectedGrantFailure(error)) {
          console.error(
            "Failed to list Search Console sites for account",
            grant.accountId,
            error,
          );
        }
        return {
          accountId: grant.accountId,
          email: null,
          requiresReconnect: true,
          sites: [],
        };
      }
    }),
  );
  return { accounts };
}

/** Map a verified property to a project. Rejects unverified properties and
 *  properties not present on the connector's grant. */
async function setSite(input: {
  projectId: string;
  organizationId: string;
  siteUrl: string;
  accountId: string;
  userId: string;
}): Promise<GscConnection> {
  const grants = await listGrantsForUser(input.userId);
  if (!grants.some((grant) => grant.accountId === input.accountId)) {
    throw new AppError(
      "NOT_FOUND",
      "That Google account isn't connected to your OpenSEO account.",
    );
  }

  const client = createGscClient({
    userId: input.userId,
    gscAccountId: input.accountId,
  });
  const sites = await client.listSites();
  const match = sites.find((s) => s.siteUrl === input.siteUrl);
  if (!match) {
    throw new AppError(
      "NOT_FOUND",
      "That Search Console property isn't available on your connected Google account.",
    );
  }
  if (match.permissionLevel === SITE_UNVERIFIED_PERMISSION) {
    throw new AppError(
      "FORBIDDEN",
      "You don't have verified access to that Search Console property.",
    );
  }
  let connectedAccountEmail: string | null = null;
  try {
    connectedAccountEmail = await client.getUserInfoEmail();
  } catch {
    connectedAccountEmail = null;
  }
  const domain = getPropertyDomain(input.siteUrl);
  const profileDomains = await ProjectRepository.listDomainsForProject(
    input.projectId,
  );
  if (!profileDomains.some((entry) => entry.domain === domain)) {
    throw new AppError(
      "VALIDATION_ERROR",
      `Add ${domain} to this profile before connecting its Search Console property.`,
    );
  }
  return GscConnectionRepository.upsert({
    projectId: input.projectId,
    organizationId: input.organizationId,
    siteUrl: input.siteUrl,
    domain,
    connectedByUserId: input.userId,
    gscAccountId: input.accountId,
    connectedAccountEmail,
  });
}

async function unlinkUserGrant(
  userId: string,
  gscAccountId: string,
): Promise<void> {
  await db
    .delete(account)
    .where(
      and(
        eq(account.userId, userId),
        eq(account.providerId, GSC_OAUTH_PROVIDER_ID),
        eq(account.accountId, gscAccountId),
      ),
    );
}

async function disconnect(input: {
  projectId: string;
  domain: string;
  userId: string;
}): Promise<void> {
  const connections = await GscConnectionRepository.listByProjectId(
    input.projectId,
  );
  const connection = connections.find((entry) => entry.domain === input.domain);
  await GscConnectionRepository.deleteByProjectDomain(
    input.projectId,
    input.domain,
  );
  if (
    connection?.gscAccountId &&
    connection.connectedByUserId === input.userId
  ) {
    const stillUsed = await GscConnectionRepository.existsForConnectorAccount(
      input.userId,
      connection.gscAccountId,
    );
    if (!stillUsed) {
      await unlinkUserGrant(input.userId, connection.gscAccountId);
    }
  }
}

/** Pass-through of GSC `searchAnalytics.query` for a project's connected property. */
async function getPerformance(
  input: GscPerformanceInput,
): Promise<GscPerformanceResult> {
  const connections = await GscConnectionRepository.listByProjectId(
    input.projectId,
  );
  if (connections.length === 0) {
    throw new GscNotConnectedError(input.projectId);
  }
  const request = buildSearchAnalyticsRequest(input);
  const rowSets = await Promise.all(
    connections.map(async (connection) => {
      const client = createGscClient({
        userId: connection.connectedByUserId,
        gscAccountId: connection.gscAccountId ?? undefined,
      });
      return client.querySearchAnalytics(connection.siteUrl, request);
    }),
  );
  return {
    siteUrl: connections.map((connection) => connection.siteUrl).join(", "),
    siteUrls: connections.map((connection) => connection.siteUrl),
    request,
    rows: mergeSearchAnalyticsRows(rowSets),
  };
}

type GscUrlInspection = {
  url: string;
  siteUrl: string;
  result: UrlInspectionResult | null;
  error?: string;
};

type GscInspectUrlsResult = {
  siteUrl: string;
  connectedBy: string | null;
  results: GscUrlInspection[];
};

/** Inspect 1–N URLs against a project's connected property. Resolves the
 *  connection once, then inspects each URL; per-URL failures are captured
 *  inline so one bad URL doesn't fail the batch. Token/grant failures
 *  propagate so the caller can prompt a reconnect. */
async function inspectUrls(input: {
  projectId: string;
  urls: string[];
  languageCode?: string;
}): Promise<GscInspectUrlsResult> {
  const connections = await GscConnectionRepository.listByProjectId(
    input.projectId,
  );
  if (connections.length === 0) {
    throw new GscNotConnectedError(input.projectId);
  }
  const results: GscUrlInspection[] = [];
  for (const url of input.urls) {
    const hostname = new URL(url).hostname.toLowerCase();
    const connection = connections
      .filter(
        (entry) =>
          hostname === entry.domain || hostname.endsWith(`.${entry.domain}`),
      )
      .toSorted((a, b) => b.domain.length - a.domain.length)[0];
    if (!connection) {
      throw new AppError(
        "NOT_FOUND",
        "No connected Search Console property matches that URL's domain.",
      );
    }
    const client = createGscClient({
      userId: connection.connectedByUserId,
      gscAccountId: connection.gscAccountId ?? undefined,
    });
    try {
      const result = await client.inspectUrl(
        connection.siteUrl,
        url,
        input.languageCode,
      );
      results.push({ url, siteUrl: connection.siteUrl, result });
    } catch (error) {
      if (error instanceof GscTokenError) throw error;
      results.push({
        url,
        siteUrl: connection.siteUrl,
        result: null,
        error: error instanceof Error ? error.message : "Inspection failed",
      });
    }
  }
  return {
    siteUrl: results[0]?.siteUrl ?? connections[0].siteUrl,
    connectedBy: connections[0].connectedAccountEmail,
    results,
  };
}

export const GscService = {
  getConnection,
  getConnections,
  userHasGrant,
  listSitesForUserWithGrantStatus,
  setSite,
  disconnect,
  getPerformance,
  inspectUrls,
};
