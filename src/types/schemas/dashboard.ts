import { z } from "zod";

export const dashboardHeroStepSchema = z.enum([
  "domain",
  "mcp",
  "gsc",
  "competitor",
]);
export type DashboardHeroStep = z.infer<typeof dashboardHeroStepSchema>;

export const dashboardProjectInputSchema = z.object({
  projectId: z.string().min(1),
  // A profile may contain multiple domains. Dashboard reads and paid snapshot
  // refreshes must be scoped to one of them, never the whole profile.
  domain: z.string().trim().min(1).max(255).optional(),
});

export const dashboardSearchSchema = z.object({
  domain: z.string().trim().min(1).max(255).optional(),
});
