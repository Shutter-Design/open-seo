import { beforeEach, describe, expect, it, vi } from "vitest";
import { getSerpResultsTool } from "./get-serp-results";
import { makeToolContext } from "./tool-test-support";

const mocks = vi.hoisted(() => ({
  createDataforseoClient: vi.fn(),
  getProjectForOrganization: vi.fn(),
}));

vi.mock("cloudflare:workers", () => ({ env: {} }));
vi.mock("@/server/lib/dataforseo", () => ({
  createDataforseoClient: mocks.createDataforseoClient,
}));
vi.mock("@/server/features/projects/services/ProjectService", () => ({
  ProjectService: {
    getProjectForOrganization: mocks.getProjectForOrganization,
  },
}));

describe("get_serp_results local mode", () => {
  beforeEach(() => {
    mocks.getProjectForOrganization.mockResolvedValue({
      id: "project_1",
      locationCode: 2826,
      languageCode: "en",
    });
  });

  it("uses a mobile top-10 SERP at the supplied city location", async () => {
    const live = vi.fn().mockResolvedValue([]);
    mocks.createDataforseoClient.mockReturnValue({ serp: { live } });

    const result = await getSerpResultsTool.handler(
      {
        projectId: "project_1",
        queries: [
          {
            keyword: "plantation shutters",
            locationName: "Kingston upon Thames,England,United Kingdom",
          },
        ],
      },
      makeToolContext(),
    );

    expect(live).toHaveBeenCalledWith({
      keyword: "plantation shutters",
      locationCode: 2826,
      languageCode: "en",
      locationName: "Kingston upon Thames,England,United Kingdom",
      device: "mobile",
      depth: 10,
    });
    expect(result.structuredContent).toMatchObject({
      results: [
        {
          keyword: "plantation shutters",
          location_name: "Kingston upon Thames,England,United Kingdom",
          device: "mobile",
          depth: 10,
        },
      ],
    });
  });

  it("uses exact coordinates when a town name is ambiguous", async () => {
    const live = vi.fn().mockResolvedValue([]);
    mocks.createDataforseoClient.mockReturnValue({ serp: { live } });

    await getSerpResultsTool.handler(
      {
        projectId: "project_1",
        queries: [
          {
            keyword: "plantation shutters",
            locationCoordinate: "51.4123,-0.3007,1000",
          },
        ],
      },
      makeToolContext(),
    );

    expect(live).toHaveBeenCalledWith({
      keyword: "plantation shutters",
      locationCode: 2826,
      languageCode: "en",
      locationCoordinate: "51.4123,-0.3007,1000",
      device: "mobile",
      depth: 10,
    });
  });
});
