import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { waitUntil } from "cloudflare:workers";
import { z } from "zod";
import { GscService } from "@/server/features/gsc/services/GscService";
import { hasSelfHostedGoogleOAuthConfig } from "@/server/features/google/oauth-config";
import {
  createSelfHostedGoogleAuthorizationUrl,
  GSC_INTEGRATION,
} from "@/server/features/google/selfHostedOAuth";
import { captureServerEvent } from "@/server/lib/posthog";
import { getPublicOrigin } from "@/server/mcp/public-origin";
import { isHostedServerAuthMode } from "@/server/lib/runtime-env";
import {
  requireAuthenticatedContext,
  requireProjectContext,
} from "@/serverFunctions/middleware";

const projectScopedSchema = z.object({ projectId: z.string().min(1) });
const getConnectionSchema = projectScopedSchema.extend({
  domain: z.string().min(1).optional(),
});
const setSiteSchema = projectScopedSchema.extend({
  accountId: z.string().min(1),
  siteUrl: z.string().min(1),
});
const disconnectSiteSchema = projectScopedSchema.extend({
  domain: z.string().min(1),
});
const startSelfHostedLinkSchema = z.object({
  callbackURL: z.string().min(1),
});

// Account-level grant check (no project needed) for surfaces like onboarding
// where the user hasn't picked a project yet. The OAuth grant is per-account;
// binding a property to a project happens later in Integrations.
export const getGscGrantStatus = createServerFn({ method: "GET" })
  .middleware(requireAuthenticatedContext)
  .handler(async ({ context }) => {
    return { connected: await GscService.userHasGrant(context.userId) };
  });

export const getGscConnection = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(getConnectionSchema)
  .handler(async ({ data, context }) => {
    const [connections, currentUserHasGrant, hosted, gscConfigured] =
      await Promise.all([
        GscService.getConnections(context.projectId),
        GscService.userHasGrant(context.userId),
        isHostedServerAuthMode(),
        hasSelfHostedGoogleOAuthConfig(),
      ]);
    const scopedConnections = data.domain
      ? connections.filter((connection) => connection.domain === data.domain)
      : connections;
    return {
      connected: scopedConnections.length > 0,
      currentUserHasGrant,
      googleOAuthConfigured: hosted || gscConfigured,
      siteUrl: scopedConnections[0]?.siteUrl ?? null,
      connectedByEmail: scopedConnections[0]?.connectedAccountEmail ?? null,
      connectedAt: scopedConnections[0]?.createdAt ?? null,
      connections: scopedConnections.map((connection) => ({
        domain: connection.domain,
        siteUrl: connection.siteUrl,
        connectedByEmail: connection.connectedAccountEmail,
        connectedAt: connection.createdAt,
      })),
    };
  });

export const listGscSites = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(projectScopedSchema)
  .handler(async ({ context }) => {
    const [siteList, connections] = await Promise.all([
      GscService.listSitesForUserWithGrantStatus(context.userId),
      GscService.getConnections(context.projectId),
    ]);
    const selectedProperties = new Set(
      connections.map(
        (connection) =>
          `${connection.gscAccountId ?? "legacy"}:${connection.siteUrl}`,
      ),
    );
    return {
      accounts: siteList.accounts.map((grant) => ({
        accountId: grant.accountId,
        email: grant.email,
        requiresReconnect: grant.requiresReconnect,
        sitesUnavailable: grant.sitesUnavailable,
        sites: grant.sites.map((site) => {
          const isSelected =
            selectedProperties.has(`${grant.accountId}:${site.siteUrl}`) ||
            selectedProperties.has(`legacy:${site.siteUrl}`);
          return {
            siteUrl: site.siteUrl,
            permissionLevel: site.permissionLevel,
            selectable: site.permissionLevel !== "siteUnverifiedUser",
            isSelected,
          };
        }),
      })),
    };
  });

export const setGscSite = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(setSiteSchema)
  .handler(async ({ data, context }) => {
    const connection = await GscService.setSite({
      projectId: context.projectId,
      organizationId: context.organizationId,
      accountId: data.accountId,
      siteUrl: data.siteUrl,
      userId: context.userId,
    });
    waitUntil(
      captureServerEvent({
        distinctId: context.userId,
        event: "gsc:property_select",
        organizationId: context.organizationId,
        properties: { project_id: context.projectId, site_url: data.siteUrl },
      }),
    );
    return { connected: true as const, siteUrl: connection.siteUrl };
  });

export const disconnectGsc = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(disconnectSiteSchema)
  .handler(async ({ data, context }) => {
    await GscService.disconnect({
      projectId: context.projectId,
      domain: data.domain,
      userId: context.userId,
    });
    waitUntil(
      captureServerEvent({
        distinctId: context.userId,
        event: "gsc:disconnect",
        organizationId: context.organizationId,
        properties: { project_id: context.projectId, domain: data.domain },
      }),
    );
    return { connected: false as const };
  });

export const startSelfHostedGscLink = createServerFn({ method: "POST" })
  .middleware(requireAuthenticatedContext)
  .validator(startSelfHostedLinkSchema)
  .handler(async ({ data, context }) => {
    const publicOrigin = getPublicOrigin(getRequest());
    const url = await createSelfHostedGoogleAuthorizationUrl({
      integration: GSC_INTEGRATION,
      user: {
        userId: context.userId,
        userEmail: context.userEmail,
      },
      callbackURL: data.callbackURL,
      publicOrigin,
    });

    return { url };
  });
