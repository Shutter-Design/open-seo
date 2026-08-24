import { beforeEach, describe, expect, it, vi } from "vitest";
import { searchSerpLocationsTool } from "./search-serp-locations";
import { makeToolContext } from "./tool-test-support";

const mocks = vi.hoisted(() => ({
  fetchSerpLocationsForCountry: vi.fn(),
  getProjectForOrganization: vi.fn(),
}));

vi.mock("cloudflare:workers", () => ({ env: {} }));
vi.mock("@/server/lib/dataforseo", () => ({
  fetchSerpLocationsForCountry: mocks.fetchSerpLocationsForCountry,
}));
vi.mock("@/server/features/projects/services/ProjectService", () => ({
  ProjectService: {
    getProjectForOrganization: mocks.getProjectForOrganization,
  },
}));

describe("search_serp_locations", () => {
  beforeEach(() => {
    mocks.getProjectForOrganization.mockResolvedValue({ id: "project_1" });
  });

  it("returns exact provider location names without creating a tracker", async () => {
    mocks.fetchSerpLocationsForCountry.mockResolvedValue([
      {
        locationCode: 100,
        locationName: "Kingston,England,United Kingdom",
        locationType: "City",
        displayLabel: "Kingston, England",
      },
      {
        locationCode: 101,
        locationName: "Richmond,England,United Kingdom",
        locationType: "City",
        displayLabel: "Richmond, England",
      },
    ]);

    const result = await searchSerpLocationsTool.handler(
      {
        projectId: "project_1",
        countryCode: "gb",
        query: "kingston",
      },
      makeToolContext(),
    );

    expect(mocks.fetchSerpLocationsForCountry).toHaveBeenCalledWith("gb");
    expect(result.structuredContent).toMatchObject({
      locations: [
        {
          location_name: "Kingston,England,United Kingdom",
          location_type: "City",
        },
      ],
    });
  });
});
