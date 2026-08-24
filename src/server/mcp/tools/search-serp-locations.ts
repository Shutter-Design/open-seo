import { z } from "zod";
import { fetchSerpLocationsForCountry } from "@/server/lib/dataforseo";
import { buildProjectMeta } from "@/server/mcp/context";
import { mcpResponse } from "@/server/mcp/formatters";
import {
  looseObjectOutputSchema,
  optionalMetaOutputSchema,
} from "@/server/mcp/output-schemas";
import { withMcpProjectAuth } from "@/server/mcp/project-auth";
import { projectIdSchema } from "@/server/mcp/schemas";
import { formatMcpTable, type McpTableColumn } from "@/server/mcp/table";

const countryCodeSchema = z.string().regex(/^[a-z]{2}$/i);

const inputSchema = {
  projectId: projectIdSchema,
  countryCode: countryCodeSchema.describe(
    "ISO 3166-1 alpha-2 country code, such as gb.",
  ),
  query: z
    .string()
    .trim()
    .min(1)
    .max(100)
    .describe(
      "City or region name to find in DataForSEO's location catalogue.",
    ),
} as const;

type Args = z.infer<z.ZodObject<typeof inputSchema>>;

type LocationRow = {
  location_code: number;
  location_name: string;
  location_type: string;
  label: string;
};

const LOCATION_COLUMNS: McpTableColumn<LocationRow>[] = [
  { header: "location", value: (row) => row.label },
  { header: "type", value: (row) => row.location_type },
  { header: "provider name", value: (row) => row.location_name },
];

export const searchSerpLocationsTool = {
  name: "search_serp_locations",
  config: {
    title: "Search Google SERP locations",
    description:
      "Search DataForSEO's free location catalogue for exact city or region names before local SERP or keyword-metric research. This does not create a tracker, save a location or charge credits.",
    inputSchema,
    outputSchema: {
      locations: z.array(looseObjectOutputSchema),
      ...optionalMetaOutputSchema,
    },
    annotations: {
      readOnlyHint: true,
      openWorldHint: false,
      destructiveHint: false,
    },
  },
  handler: withMcpProjectAuth(async (args: Args, context) => {
    const needle = args.query.toLowerCase();
    const locations = (await fetchSerpLocationsForCountry(args.countryCode))
      .filter((location) =>
        location.displayLabel.toLowerCase().includes(needle),
      )
      .slice(0, 10)
      .map((location) => ({
        location_code: location.locationCode,
        location_name: location.locationName,
        location_type: location.locationType,
        label: location.displayLabel,
      }));
    const header = `Found ${locations.length} provider locations for "${args.query}" in ${args.countryCode.toUpperCase()}.`;

    return mcpResponse({
      text:
        locations.length === 0
          ? header
          : `${header}\n${formatMcpTable(locations, LOCATION_COLUMNS)}`,
      meta: buildProjectMeta(
        context,
        args.projectId,
        `/p/${args.projectId}/rank-tracking`,
      ),
      structuredContent: { locations },
    });
  }),
};
