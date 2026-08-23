import { createServerFn } from "@tanstack/react-start";
import { ActivationRepository } from "@/server/features/activation/repositories/ActivationRepository";
import { DashboardService } from "@/server/features/dashboard/services/DashboardService";
import { ProjectRepository } from "@/server/features/projects/repositories/ProjectRepository";
import { AppError } from "@/server/lib/errors";
import { requireProjectContext } from "@/serverFunctions/middleware";
import { dashboardProjectInputSchema } from "@/types/schemas/dashboard";

async function resolveDashboardDomain(
  projectId: string,
  primaryDomain: string | null,
  requestedDomain: string | undefined,
): Promise<string | null> {
  if (!requestedDomain) return primaryDomain;

  const domains = await ProjectRepository.listDomainsForProject(projectId);
  if (!domains.some((entry) => entry.domain === requestedDomain)) {
    throw new AppError(
      "VALIDATION_ERROR",
      "That domain is not in this profile.",
    );
  }
  return requestedDomain;
}

export const getDashboardActivation = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(dashboardProjectInputSchema)
  .handler(async ({ data, context }) =>
    DashboardService.getActivation({
      projectId: context.projectId,
      organizationId: context.organizationId,
      domain: await resolveDashboardDomain(
        context.projectId,
        context.project.domain,
        data.domain,
      ),
    }),
  );

export const getDashboardOverview = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(dashboardProjectInputSchema)
  .handler(async ({ data, context }) =>
    DashboardService.getOverview({
      projectId: context.projectId,
      domain: await resolveDashboardDomain(
        context.projectId,
        context.project.domain,
        data.domain,
      ),
    }),
  );

// Visit-triggered: the client calls this when the overview reports a missing
// or stale backlink snapshot. Metered against org credits at most once per
// project per day (the service re-checks freshness server-side).
export const refreshDashboardBacklinkSnapshot = createServerFn({
  method: "POST",
})
  .middleware(requireProjectContext)
  .validator(dashboardProjectInputSchema)
  .handler(async ({ data, context }) =>
    DashboardService.ensureBacklinkSnapshot({
      projectId: context.projectId,
      domain: await resolveDashboardDomain(
        context.projectId,
        context.project.domain,
        data.domain,
      ),
      billingCustomer: context,
    }),
  );

export const markDashboardCompetitorClicked = createServerFn({
  method: "POST",
})
  .middleware(requireProjectContext)
  .validator(dashboardProjectInputSchema)
  .handler(async ({ context }) => {
    await ActivationRepository.markCompetitorStepClicked(context.projectId);
    return { ok: true as const };
  });

// "I already connected" on the MCP card. Hides the card for this project;
// the org-level milestone stays untouched and self-corrects on the next
// real external tool call.
export const dismissDashboardMcpCard = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(dashboardProjectInputSchema)
  .handler(async ({ context }) => {
    await ActivationRepository.markMcpCardDismissed(context.projectId);
    return { ok: true as const };
  });

// Hides only the optional GA4 pitch on this project's dashboard. The
// integration remains available in Project Settings and a later connection
// makes the dashboard card visible again.
export const dismissDashboardGa4Card = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(dashboardProjectInputSchema)
  .handler(async ({ context }) => {
    await ActivationRepository.markGa4CardDismissed(context.projectId);
    return { ok: true as const };
  });
