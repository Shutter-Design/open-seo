import { beforeEach, describe, expect, it, vi } from "vitest";
import { DashboardService } from "./DashboardService";

const mocks = vi.hoisted(() => ({
  getOrganizationActivation: vi.fn(),
  getProjectActivation: vi.fn(),
  getLatestAuditForProject: vi.fn(),
  getAuditsByProject: vi.fn(),
  getIssueTypePageCountsForAudit: vi.fn(),
  getLatestForProject: vi.fn(),
  getLatestForProjectDomain: vi.fn(),
  getGa4Connection: vi.fn(),
  getGscConnection: vi.fn(),
  getGscConnectionForDomain: vi.fn(),
  getConfigsForProject: vi.fn(),
  getLatestResults: vi.fn(),
}));

vi.mock(
  "@/server/features/activation/repositories/ActivationRepository",
  () => ({
    ActivationRepository: {
      getOrganizationActivation: mocks.getOrganizationActivation,
      getProjectActivation: mocks.getProjectActivation,
    },
  }),
);
vi.mock("@/server/features/audit/repositories/AuditRepository", () => ({
  AuditRepository: {
    getLatestAuditForProject: mocks.getLatestAuditForProject,
    getAuditsByProject: mocks.getAuditsByProject,
  },
}));
vi.mock("@/server/features/audit/repositories/auditSummaryQueries", () => ({
  getIssueTypePageCountsForAudit: mocks.getIssueTypePageCountsForAudit,
}));
vi.mock(
  "@/server/features/dashboard/repositories/BacklinkSnapshotRepository",
  () => ({
    BacklinkSnapshotRepository: {
      getLatestForProject: mocks.getLatestForProject,
      getLatestForProjectDomain: mocks.getLatestForProjectDomain,
      insert: vi.fn(),
    },
  }),
);
vi.mock("@/server/features/ga4/repositories/Ga4ConnectionRepository", () => ({
  Ga4ConnectionRepository: { getByProjectId: mocks.getGa4Connection },
}));
vi.mock("@/server/features/gsc/repositories/GscConnectionRepository", () => ({
  GscConnectionRepository: {
    getByProjectId: mocks.getGscConnection,
    getByProjectDomain: mocks.getGscConnectionForDomain,
  },
}));
vi.mock(
  "@/server/features/rank-tracking/repositories/RankTrackingRepository",
  () => ({
    RankTrackingRepository: {
      getConfigsForProject: mocks.getConfigsForProject,
    },
  }),
);
vi.mock("@/server/features/rank-tracking/services/rankTrackingResults", () => ({
  getLatestResults: mocks.getLatestResults,
}));
vi.mock("@/server/lib/dataforseo", () => ({
  createDataforseoClient: vi.fn(),
  normalizeBacklinksTarget: vi.fn(),
}));

describe("DashboardService domain scope", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.getOrganizationActivation.mockResolvedValue(null);
    mocks.getProjectActivation.mockResolvedValue(null);
    mocks.getGa4Connection.mockResolvedValue(null);
    mocks.getGscConnectionForDomain.mockResolvedValue(null);
    mocks.getConfigsForProject.mockResolvedValue([]);
    mocks.getAuditsByProject.mockResolvedValue([
      {
        id: "first-audit",
        startUrl: "https://first.example/",
        status: "completed",
        pagesCrawled: 3,
        startedAt: "2026-08-22T12:00:00.000Z",
      },
      {
        id: "second-audit",
        startUrl: "https://www.second.example/",
        status: "completed",
        pagesCrawled: 4,
        startedAt: "2026-08-23T12:00:00.000Z",
      },
    ]);
    mocks.getIssueTypePageCountsForAudit.mockResolvedValue([]);
    mocks.getLatestForProjectDomain.mockResolvedValue({
      domain: "second.example",
      rank: null,
      backlinks: 15,
      referringDomains: 3,
      newBacklinks: 1,
      lostBacklinks: 0,
      newReferringDomains: 1,
      lostReferringDomains: 0,
      capturedAt: new Date().toISOString(),
    });
  });

  it("loads the selected domain's connection and records only", async () => {
    await expect(
      DashboardService.getActivation({
        projectId: "project-1",
        organizationId: "org-1",
        domain: "second.example",
      }),
    ).resolves.toMatchObject({ domain: "second.example" });

    const overview = await DashboardService.getOverview({
      projectId: "project-1",
      domain: "second.example",
    });

    expect(mocks.getGscConnectionForDomain).toHaveBeenCalledWith(
      "project-1",
      "second.example",
    );
    expect(mocks.getAuditsByProject).toHaveBeenCalledWith("project-1");
    expect(mocks.getLatestForProjectDomain).toHaveBeenCalledWith(
      "project-1",
      "second.example",
    );
    expect(mocks.getLatestAuditForProject).not.toHaveBeenCalled();
    expect(mocks.getLatestForProject).not.toHaveBeenCalled();
    expect(mocks.getIssueTypePageCountsForAudit).toHaveBeenCalledWith(
      "second-audit",
    );
    expect(overview.audit).toMatchObject({ pagesCrawled: 4 });
    expect(overview.backlinks).toMatchObject({ domain: "second.example" });
  });
});
