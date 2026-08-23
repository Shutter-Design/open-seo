import { describe, expect, it } from "vitest";
import {
  createProjectSchema,
  setProjectDomainsSchema,
  updateProjectSchema,
} from "./projects";

// The service derives a missing language from the location, so a language
// arriving on its own has nothing to validate against.
describe("project market fields", () => {
  it("rejects a language with no location", () => {
    expect(
      updateProjectSchema.safeParse({
        projectId: "project_1",
        name: "Acme",
        languageCode: "vi",
      }).success,
    ).toBe(false);
    expect(
      createProjectSchema.safeParse({ name: "Acme", languageCode: "vi" })
        .success,
    ).toBe(false);
  });

  it("accepts a location on its own, and a full pair", () => {
    expect(
      createProjectSchema.safeParse({ name: "Acme", locationCode: 2704 })
        .success,
    ).toBe(true);
    expect(
      updateProjectSchema.safeParse({
        projectId: "project_1",
        name: "Acme",
        locationCode: 2704,
        languageCode: "vi",
      }).success,
    ).toBe(true);
  });

  it("accepts a project with no market at all", () => {
    expect(createProjectSchema.safeParse({ name: "Acme" }).success).toBe(true);
  });
});

describe("profile domain list", () => {
  it("accepts a bounded editable list with a primary domain", () => {
    expect(
      setProjectDomainsSchema.safeParse({
        projectId: "project_1",
        domains: ["acme.com", "acme.co.uk"],
        primaryDomain: "acme.co.uk",
      }).success,
    ).toBe(true);
  });
});
