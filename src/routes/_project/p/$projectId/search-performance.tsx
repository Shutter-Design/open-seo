import { createFileRoute } from "@tanstack/react-router";
import { SearchPerformancePage } from "@/client/features/search-performance/SearchPerformancePage";
import { searchPerformanceSearchSchema } from "@/types/schemas/search-performance";

export const Route = createFileRoute(
  "/_project/p/$projectId/search-performance",
)({
  validateSearch: searchPerformanceSearchSchema,
  component: SearchPerformanceRoute,
});

function SearchPerformanceRoute() {
  const { projectId } = Route.useParams();
  const { domain } = Route.useSearch();
  return <SearchPerformancePage projectId={projectId} domain={domain} />;
}
