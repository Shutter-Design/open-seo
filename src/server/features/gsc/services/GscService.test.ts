/* eslint-disable max-lines */
import type { SQL } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { GscSearchAnalyticsRow } from "@/server/lib/gscClient";
import { GscApiError, GscTokenError } from "@/server/lib/gscErrors";
import { GscService } from "./GscService";

const mocks = vi.hoisted(() => {
  const state: { selectRows: Array<{ id: string; accountId: string }> } = {
    selectRows: [],
  };
  type GscClientOptions = { userId: string; gscAccountId?: string };
  type GscSite = { siteUrl: string; permissionLevel: string };
  const listSites = vi.fn<(opts: GscClientOptions) => Promise<GscSite[]>>();
  const getUserInfoEmail =
    vi.fn<(opts: GscClientOptions) => Promise<string | null>>();
  const querySearchAnalytics =
    vi.fn<(opts: GscClientOptions) => Promise<GscSearchAnalyticsRow[]>>();
  const deleteWhere = vi
    .fn<(condition: SQL) => Promise<void>>()
    .mockResolvedValue(undefined);
  const dbSelect = vi.fn(() => ({
    from: vi.fn(() => ({
      where: vi.fn(() => {
        const rows = state.selectRows;
        return Object.assign(Promise.resolve(rows), {
          limit: vi.fn().mockResolvedValue(rows),
        });
      }),
    })),
  }));

  return {
    state,
    dbSelect,
    deleteWhere,
    dbDelete: vi.fn(() => ({ where: deleteWhere })),
    listSites,
    getUserInfoEmail,
    querySearchAnalytics,
    createGscClient: vi.fn((opts: GscClientOptions) => ({
      listSites: () => listSites(opts),
      getUserInfoEmail: () => getUserInfoEmail(opts),
      querySearchAnalytics: () => querySearchAnalytics(opts),
    })),
    upsert: vi.fn(),
    getByProjectId: vi.fn(),
    listByProjectId: vi.fn(),
    deleteByProjectDomain: vi.fn(),
    existsForConnectorAccount: vi.fn(),
    listDomainsForProject: vi.fn(),
  };
});

vi.mock("cloudflare:workers", () => ({ env: {} }));
vi.mock("@/db", () => ({
  db: { select: mocks.dbSelect, delete: mocks.dbDelete },
}));
vi.mock("@/server/lib/gscClient", () => ({
  createGscClient: mocks.createGscClient,
}));
vi.mock("@/server/features/gsc/repositories/GscConnectionRepository", () => ({
  GscConnectionRepository: {
    upsert: mocks.upsert,
    getByProjectId: mocks.getByProjectId,
    listByProjectId: mocks.listByProjectId,
    deleteByProjectDomain: mocks.deleteByProjectDomain,
    existsForConnectorAccount: mocks.existsForConnectorAccount,
  },
}));
vi.mock("@/server/features/projects/repositories/ProjectRepository", () => ({
  ProjectRepository: {
    listDomainsForProject: mocks.listDomainsForProject,
  },
}));

const baseInput = {
  projectId: "p1",
  organizationId: "org1",
  accountId: "sub-a",
  userId: "u1",
};

function collectSqlParams(value: unknown): unknown[] {
  if (!value || typeof value !== "object") return [];
  if ("value" in value && "encoder" in value) {
    return [value.value];
  }
  if (!("queryChunks" in value) || !Array.isArray(value.queryChunks)) return [];
  return value.queryChunks.flatMap(collectSqlParams);
}

describe("GscService.setSite", () => {
  beforeEach(() => {
    mocks.state.selectRows = [{ id: "grant-a", accountId: "sub-a" }];
    mocks.listSites.mockReset();
    mocks.getUserInfoEmail.mockReset();
    mocks.createGscClient.mockClear();
    mocks.upsert.mockReset();
    mocks.listDomainsForProject.mockResolvedValue([{ domain: "x.com" }]);
  });

  it("upserts a verified property with the selected grant and userinfo email", async () => {
    mocks.listSites.mockResolvedValue([
      { siteUrl: "https://x.com/", permissionLevel: "siteOwner" },
    ]);
    mocks.getUserInfoEmail.mockResolvedValue("client@example.com");
    mocks.upsert.mockResolvedValue({ siteUrl: "https://x.com/" });

    await GscService.setSite({ ...baseInput, siteUrl: "https://x.com/" });

    expect(mocks.createGscClient).toHaveBeenCalledWith({
      userId: "u1",
      gscAccountId: "sub-a",
    });
    expect(mocks.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: "p1",
        siteUrl: "https://x.com/",
        domain: "x.com",
        connectedByUserId: "u1",
        gscAccountId: "sub-a",
        connectedAccountEmail: "client@example.com",
      }),
    );
  });

  it("re-saves with a null email when userinfo is unavailable", async () => {
    mocks.listSites.mockResolvedValue([
      { siteUrl: "https://x.com/", permissionLevel: "siteOwner" },
    ]);
    mocks.getUserInfoEmail.mockRejectedValue(new Error("userinfo unavailable"));
    mocks.upsert.mockResolvedValue({
      siteUrl: "https://x.com/",
      connectedAccountEmail: "previous@example.com",
    });

    const result = await GscService.setSite({
      ...baseInput,
      siteUrl: "https://x.com/",
    });

    expect(mocks.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ connectedAccountEmail: null }),
    );
    expect(result).toMatchObject({
      connectedAccountEmail: "previous@example.com",
    });
  });

  it("rejects a Google sub that is not one of the caller's grants", async () => {
    await expect(
      GscService.setSite({
        ...baseInput,
        accountId: "foreign-sub",
        siteUrl: "https://x.com/",
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(mocks.createGscClient).not.toHaveBeenCalled();
    expect(mocks.upsert).not.toHaveBeenCalled();
  });

  it("rejects an unverified property with FORBIDDEN", async () => {
    mocks.listSites.mockResolvedValue([
      { siteUrl: "https://x.com/", permissionLevel: "siteUnverifiedUser" },
    ]);

    await expect(
      GscService.setSite({ ...baseInput, siteUrl: "https://x.com/" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(mocks.upsert).not.toHaveBeenCalled();
  });

  it("rejects a property not on the selected grant with NOT_FOUND", async () => {
    mocks.listSites.mockResolvedValue([
      { siteUrl: "https://x.com/", permissionLevel: "siteOwner" },
    ]);

    await expect(
      GscService.setSite({ ...baseInput, siteUrl: "https://not-mine/" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(mocks.upsert).not.toHaveBeenCalled();
  });

  it("requires a matching profile domain before binding a property", async () => {
    mocks.listSites.mockResolvedValue([
      { siteUrl: "https://x.com/", permissionLevel: "siteOwner" },
    ]);
    mocks.listDomainsForProject.mockResolvedValue([{ domain: "other.com" }]);

    await expect(
      GscService.setSite({ ...baseInput, siteUrl: "https://x.com/" }),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect(mocks.upsert).not.toHaveBeenCalled();
  });
});

describe("GscService.listSitesForUserWithGrantStatus", () => {
  beforeEach(() => {
    mocks.state.selectRows = [
      { id: "grant-a", accountId: "sub-a" },
      { id: "grant-b", accountId: "sub-b" },
    ];
    mocks.listSites.mockReset();
    mocks.getUserInfoEmail.mockReset();
    mocks.createGscClient.mockClear();
    mocks.dbDelete.mockClear();
  });

  it("lists grants independently and never deletes a dead grant", async () => {
    mocks.getUserInfoEmail.mockImplementation(
      async ({ gscAccountId }: { gscAccountId?: string }) =>
        `${gscAccountId}@example.com`,
    );
    mocks.listSites.mockImplementation(
      async ({ gscAccountId }: { gscAccountId?: string }) => {
        if (gscAccountId === "sub-b") throw new GscTokenError("revoked");
        return [{ siteUrl: "https://x.com/", permissionLevel: "siteOwner" }];
      },
    );

    await expect(
      GscService.listSitesForUserWithGrantStatus("u1"),
    ).resolves.toEqual({
      accounts: [
        {
          accountId: "sub-a",
          email: "sub-a@example.com",
          requiresReconnect: false,
          sitesUnavailable: false,
          sites: [{ siteUrl: "https://x.com/", permissionLevel: "siteOwner" }],
        },
        {
          accountId: "sub-b",
          email: null,
          requiresReconnect: true,
          sitesUnavailable: false,
          sites: [],
        },
      ],
    });
    expect(mocks.createGscClient).toHaveBeenCalledTimes(2);
    expect(mocks.getUserInfoEmail).not.toHaveBeenCalledWith(
      expect.objectContaining({ gscAccountId: "sub-b" }),
    );
    expect(mocks.dbDelete).not.toHaveBeenCalled();
  });

  it("keeps userinfo failures non-fatal", async () => {
    mocks.state.selectRows = [{ id: "grant-a", accountId: "sub-a" }];
    mocks.getUserInfoEmail.mockRejectedValue(new Error("userinfo unavailable"));
    mocks.listSites.mockResolvedValue([
      { siteUrl: "https://x.com/", permissionLevel: "siteOwner" },
    ]);

    await expect(
      GscService.listSitesForUserWithGrantStatus("u1"),
    ).resolves.toEqual({
      accounts: [
        {
          accountId: "sub-a",
          email: null,
          requiresReconnect: false,
          sitesUnavailable: false,
          sites: [{ siteUrl: "https://x.com/", permissionLevel: "siteOwner" }],
        },
      ],
    });
  });

  it("reports a GSC 403 as unavailable instead of an expired grant", async () => {
    mocks.state.selectRows = [{ id: "grant-a", accountId: "sub-a" }];
    mocks.getUserInfoEmail.mockResolvedValue("a@example.com");
    mocks.listSites.mockRejectedValue(
      new GscApiError(403, "Search Console denied access"),
    );
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);

    await expect(
      GscService.listSitesForUserWithGrantStatus("u1"),
    ).resolves.toEqual({
      accounts: [
        {
          accountId: "sub-a",
          email: null,
          requiresReconnect: false,
          sitesUnavailable: true,
          sites: [],
        },
      ],
    });
    expect(mocks.getUserInfoEmail).not.toHaveBeenCalled();
    expect(mocks.dbDelete).not.toHaveBeenCalled();
    expect(consoleError).toHaveBeenCalledWith("gsc.site_discovery_failed", {
      errorName: "GscApiError",
      status: 403,
    });
    consoleError.mockRestore();
  });

  it("keeps non-auth GSC API errors reportable", async () => {
    mocks.getUserInfoEmail.mockImplementation(
      async ({ gscAccountId }: { gscAccountId?: string }) =>
        `${gscAccountId}@example.com`,
    );
    const rateLimit = new GscApiError(429, "slow down");
    mocks.listSites.mockImplementation(
      async ({ gscAccountId }: { gscAccountId?: string }) => {
        if (gscAccountId === "sub-b") throw rateLimit;
        return [{ siteUrl: "https://x.com/", permissionLevel: "siteOwner" }];
      },
    );
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);

    await expect(
      GscService.listSitesForUserWithGrantStatus("u1"),
    ).resolves.toEqual({
      accounts: [
        {
          accountId: "sub-a",
          email: "sub-a@example.com",
          requiresReconnect: false,
          sitesUnavailable: false,
          sites: [{ siteUrl: "https://x.com/", permissionLevel: "siteOwner" }],
        },
        {
          accountId: "sub-b",
          email: null,
          requiresReconnect: false,
          sitesUnavailable: true,
          sites: [],
        },
      ],
    });
    expect(consoleError).toHaveBeenCalledWith("gsc.site_discovery_failed", {
      errorName: "GscApiError",
      status: 429,
    });
    expect(mocks.dbDelete).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });
});

describe("GscService.getPerformance", () => {
  beforeEach(() => {
    mocks.listByProjectId.mockReset();
    mocks.querySearchAnalytics.mockReset().mockResolvedValue([]);
    mocks.createGscClient.mockClear();
  });

  it("uses the grant stored on the project connection", async () => {
    mocks.listByProjectId.mockResolvedValue([
      {
        connectedByUserId: "u1",
        connectedAccountEmail: "a@example.com",
        gscAccountId: "sub-a",
        siteUrl: "https://x.com/",
      },
    ]);

    await GscService.getPerformance({
      projectId: "p1",
      startDate: "2026-01-01",
      endDate: "2026-01-31",
    });

    expect(mocks.createGscClient).toHaveBeenCalledWith({
      userId: "u1",
      gscAccountId: "sub-a",
    });
  });

  it("passes undefined for the legacy null-account fallback", async () => {
    mocks.listByProjectId.mockResolvedValue([
      {
        connectedByUserId: "u1",
        connectedAccountEmail: null,
        gscAccountId: null,
        siteUrl: "https://x.com/",
      },
    ]);

    await GscService.getPerformance({
      projectId: "p1",
      startDate: "2026-01-01",
      endDate: "2026-01-31",
    });

    expect(mocks.createGscClient).toHaveBeenCalledWith({
      userId: "u1",
      gscAccountId: undefined,
    });
  });

  it("combines matching report rows across the profile's properties", async () => {
    mocks.listByProjectId.mockResolvedValue([
      {
        connectedByUserId: "u1",
        connectedAccountEmail: "a@example.com",
        gscAccountId: "sub-a",
        siteUrl: "https://x.com/",
      },
      {
        connectedByUserId: "u1",
        connectedAccountEmail: "a@example.com",
        gscAccountId: "sub-b",
        siteUrl: "https://y.com/",
      },
    ]);
    mocks.querySearchAnalytics.mockImplementation(({ gscAccountId }) =>
      Promise.resolve([
        {
          keys: ["shutters"],
          clicks: gscAccountId === "sub-a" ? 10 : 5,
          impressions: gscAccountId === "sub-a" ? 100 : 300,
          ctr: 0,
          position: gscAccountId === "sub-a" ? 4 : 8,
        },
      ]),
    );

    const result = await GscService.getPerformance({
      projectId: "p1",
      startDate: "2026-01-01",
      endDate: "2026-01-31",
      dimensions: ["query"],
    });

    expect(result.rows).toEqual([
      {
        keys: ["shutters"],
        clicks: 15,
        impressions: 400,
        ctr: 15 / 400,
        position: 7,
      },
    ]);
  });

  it("uses only the selected domain's property", async () => {
    mocks.listByProjectId.mockResolvedValue([
      {
        connectedByUserId: "u1",
        gscAccountId: "sub-a",
        domain: "x.com",
        siteUrl: "https://x.com/",
      },
      {
        connectedByUserId: "u1",
        gscAccountId: "sub-b",
        domain: "y.com",
        siteUrl: "https://y.com/",
      },
    ]);

    const result = await GscService.getPerformance({
      projectId: "p1",
      domain: "y.com",
      startDate: "2026-01-01",
      endDate: "2026-01-31",
    });

    expect(mocks.createGscClient).toHaveBeenCalledTimes(1);
    expect(mocks.createGscClient).toHaveBeenCalledWith({
      userId: "u1",
      gscAccountId: "sub-b",
    });
    expect(result.siteUrls).toEqual(["https://y.com/"]);
  });
});

describe("GscService.disconnect", () => {
  beforeEach(() => {
    mocks.listByProjectId.mockReset();
    mocks.deleteByProjectDomain.mockReset().mockResolvedValue(undefined);
    mocks.existsForConnectorAccount.mockReset();
    mocks.dbDelete.mockClear();
    mocks.deleteWhere.mockClear();
  });

  it("unlinks only the disconnected account when it is no longer used", async () => {
    mocks.listByProjectId.mockResolvedValue([
      {
        connectedByUserId: "u1",
        gscAccountId: "sub-b",
        domain: "x.com",
      },
    ]);
    mocks.existsForConnectorAccount.mockResolvedValue(false);

    await GscService.disconnect({
      projectId: "p1",
      domain: "x.com",
      userId: "u1",
    });

    expect(mocks.deleteByProjectDomain).toHaveBeenCalledWith("p1", "x.com");
    expect(mocks.existsForConnectorAccount).toHaveBeenCalledWith("u1", "sub-b");
    expect(mocks.dbDelete).toHaveBeenCalledTimes(1);
    const whereCondition = mocks.deleteWhere.mock.calls[0]?.[0];
    expect(collectSqlParams(whereCondition)).toEqual(
      expect.arrayContaining(["u1", "google-search-console", "sub-b"]),
    );
  });

  it("keeps the grant when the same account powers another project", async () => {
    mocks.listByProjectId.mockResolvedValue([
      {
        connectedByUserId: "u1",
        gscAccountId: "sub-b",
        domain: "x.com",
      },
    ]);
    mocks.existsForConnectorAccount.mockResolvedValue(true);

    await GscService.disconnect({
      projectId: "p1",
      domain: "x.com",
      userId: "u1",
    });

    expect(mocks.dbDelete).not.toHaveBeenCalled();
  });

  it("never revokes a grant when another member disconnects", async () => {
    mocks.listByProjectId.mockResolvedValue([
      {
        connectedByUserId: "owner",
        gscAccountId: "sub-b",
        domain: "x.com",
      },
    ]);

    await GscService.disconnect({
      projectId: "p1",
      domain: "x.com",
      userId: "other-member",
    });

    expect(mocks.existsForConnectorAccount).not.toHaveBeenCalled();
    expect(mocks.dbDelete).not.toHaveBeenCalled();
  });

  it("deletes no grants for a legacy null-account connection", async () => {
    mocks.listByProjectId.mockResolvedValue([
      {
        connectedByUserId: "u1",
        gscAccountId: null,
        domain: "x.com",
      },
    ]);

    await GscService.disconnect({
      projectId: "p1",
      domain: "x.com",
      userId: "u1",
    });

    expect(mocks.deleteByProjectDomain).toHaveBeenCalledWith("p1", "x.com");
    expect(mocks.existsForConnectorAccount).not.toHaveBeenCalled();
    expect(mocks.dbDelete).not.toHaveBeenCalled();
  });

  it("deletes no grants when no property was bound", async () => {
    mocks.listByProjectId.mockResolvedValue([]);

    await GscService.disconnect({
      projectId: "p1",
      domain: "x.com",
      userId: "u1",
    });

    expect(mocks.existsForConnectorAccount).not.toHaveBeenCalled();
    expect(mocks.dbDelete).not.toHaveBeenCalled();
  });
});
