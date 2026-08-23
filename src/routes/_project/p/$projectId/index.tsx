import { createFileRoute } from "@tanstack/react-router";
import { DashboardPage } from "@/client/features/dashboard/DashboardPage";
import { dashboardSearchSchema } from "@/types/schemas/dashboard";

export const Route = createFileRoute("/_project/p/$projectId/")({
  validateSearch: dashboardSearchSchema,
  component: DashboardRoute,
});

function DashboardRoute() {
  const { projectId } = Route.useParams();
  const { domain } = Route.useSearch();
  return <DashboardPage projectId={projectId} requestedDomain={domain} />;
}
