import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { isHostedClientAuthMode } from "@/lib/auth-mode";
import { getStandardErrorMessage } from "@/client/lib/error-messages";
import { captureClientEvent } from "@/client/lib/posthog";
import { GoogleGlyph } from "@/client/features/gsc/GoogleGlyph";
import { IntegrationConnectionCard } from "@/client/features/integrations/IntegrationConnectionCard";
import { GoogleSearchConsoleLogo } from "@/client/features/integrations/GoogleProductLogos";
import { SelfHostedSetupWarning } from "@/client/features/gsc/SelfHostedSetupWarning";
import {
  SitePicker,
  type GscSiteSelection,
} from "@/client/features/gsc/SitePicker";
import { startGoogleLink } from "@/client/features/integrations/startGoogleLink";
import {
  disconnectGsc,
  getGscConnection,
  listGscSites,
  setGscSite,
} from "@/serverFunctions/gsc";

const GRANT_STATUS_KEY = ["gscGrantStatus"];

export function SearchConsoleConnectionCard({
  projectId,
}: {
  projectId: string;
}) {
  const hosted = isHostedClientAuthMode();
  const queryClient = useQueryClient();
  const [picking, setPicking] = React.useState(false);
  const [selection, setSelection] = React.useState<GscSiteSelection | null>(
    null,
  );

  const connectionKey = ["gscConnection", projectId];
  const connectionQuery = useQuery({
    queryKey: connectionKey,
    queryFn: () => getGscConnection({ data: { projectId } }),
  });
  const connection = connectionQuery.data;
  const connected = Boolean(connection?.connected);
  const selfHostedNeedsSetup =
    !hosted && connectionQuery.isSuccess && !connection?.googleOAuthConfigured;

  const showPicker = picking || (connection?.currentUserHasGrant && !connected);
  const sitesQuery = useQuery({
    queryKey: ["gscSites", projectId],
    queryFn: () => listGscSites({ data: { projectId } }),
    enabled: Boolean(showPicker && !selfHostedNeedsSetup),
  });
  const accounts = React.useMemo(
    () => sitesQuery.data?.accounts ?? [],
    [sitesQuery.data?.accounts],
  );
  const requiresReconnect = accounts.some(
    (account) => account.requiresReconnect,
  );

  React.useEffect(() => {
    if (!requiresReconnect) return;

    void queryClient.invalidateQueries({
      queryKey: ["gscConnection", projectId],
    });
    void queryClient.invalidateQueries({ queryKey: GRANT_STATUS_KEY });
  }, [requiresReconnect, queryClient, projectId]);

  const setSiteMutation = useMutation({
    mutationFn: (selected: GscSiteSelection) =>
      setGscSite({ data: { projectId, ...selected } }),
    onSuccess: () => {
      captureClientEvent("gsc:property_select");
      toast.success("Search Console property saved");
      setPicking(false);
      void queryClient.invalidateQueries({ queryKey: connectionKey });
      void queryClient.invalidateQueries({ queryKey: GRANT_STATUS_KEY });
      // The Search Performance report caches {connected:false}; refresh it so
      // the page shows data right after connecting instead of the stale card.
      void queryClient.invalidateQueries({
        queryKey: ["searchPerformance", projectId],
      });
      void queryClient.invalidateQueries({
        queryKey: ["searchPerformanceTable", projectId],
      });
      // The dashboard embeds this card and swaps it for the Search
      // performance stats card once activation reports the connection.
      void queryClient.invalidateQueries({
        queryKey: ["dashboardActivation", projectId],
      });
      void queryClient.invalidateQueries({
        queryKey: ["dashboardGscReport", projectId],
      });
    },
    onError: (error) => toast.error(getStandardErrorMessage(error)),
  });

  const disconnectMutation = useMutation({
    mutationFn: (domain: string) =>
      disconnectGsc({ data: { projectId, domain } }),
    onSuccess: () => {
      toast.success("Search Console disconnected");
      setPicking(false);
      setSelection(null);
      void queryClient.invalidateQueries({ queryKey: connectionKey });
      // Disconnect can drop the account-level grant server-side; keep the
      // shared grant-status cache (onboarding step + re-engagement nudge) honest.
      void queryClient.invalidateQueries({ queryKey: GRANT_STATUS_KEY });
      void queryClient.invalidateQueries({
        queryKey: ["searchPerformance", projectId],
      });
      void queryClient.invalidateQueries({
        queryKey: ["searchPerformanceTable", projectId],
      });
      void queryClient.invalidateQueries({
        queryKey: ["dashboardActivation", projectId],
      });
      void queryClient.invalidateQueries({
        queryKey: ["dashboardGscReport", projectId],
      });
    },
    onError: (error) => toast.error(getStandardErrorMessage(error)),
  });

  const handleConnect = () => void startGoogleLink("gsc", window.location.href);

  return (
    <IntegrationConnectionCard
      title="Google Search Console"
      icon={<GoogleSearchConsoleLogo className="size-5" />}
      status={
        connectionQuery.isLoading
          ? undefined
          : selfHostedNeedsSetup
            ? "setup_required"
            : connected
              ? "connected"
              : "disconnected"
      }
    >
      {connectionQuery.isLoading ? (
        <div className="flex items-center gap-2 text-sm text-base-content/50">
          <span className="loading loading-spinner loading-sm" />
          Checking…
        </div>
      ) : selfHostedNeedsSetup ? (
        <SelfHostedSetupWarning />
      ) : connected && !picking ? (
        <ConnectedState
          connections={connection?.connections ?? []}
          onAdd={() => {
            setSelection(null);
            setPicking(true);
          }}
          onDisconnect={(domain) => disconnectMutation.mutate(domain)}
          disconnectingDomain={
            disconnectMutation.isPending ? disconnectMutation.variables : null
          }
        />
      ) : showPicker ? (
        <SitePicker
          loading={sitesQuery.isLoading}
          error={sitesQuery.isError}
          accounts={accounts}
          selection={selection}
          onSelect={setSelection}
          onSave={() => selection && setSiteMutation.mutate(selection)}
          saving={setSiteMutation.isPending}
          onRetry={() => void sitesQuery.refetch()}
          onReconnect={handleConnect}
          secondaryAction={
            connected
              ? { label: "Cancel", onClick: () => setPicking(false) }
              : undefined
          }
        />
      ) : (
        <div className="space-y-4">
          <p className="text-sm text-base-content/70">
            Connect GSC to see how your website is actually performing in Google
            Search.
          </p>
          <button
            type="button"
            onClick={handleConnect}
            className="inline-flex items-center gap-2.5 rounded-lg border border-base-300 bg-base-100 px-4 py-2.5 text-sm font-semibold text-base-content shadow-sm transition hover:bg-base-200 hover:shadow focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
          >
            <GoogleGlyph className="size-[18px]" />
            Connect with Google
          </button>
        </div>
      )}
    </IntegrationConnectionCard>
  );
}

// ---------------------------------------------------------------------------
// Connected state
// ---------------------------------------------------------------------------

function ConnectedState({
  connections,
  onAdd,
  onDisconnect,
  disconnectingDomain,
}: {
  connections: Array<{
    domain: string;
    siteUrl: string;
    connectedByEmail: string | null;
  }>;
  onAdd: () => void;
  onDisconnect: (domain: string) => void;
  disconnectingDomain: string | null;
}) {
  return (
    <div className="space-y-4">
      <div className="space-y-2">
        {connections.map((connection) => (
          <div
            key={connection.domain}
            className="flex items-center gap-3 rounded-lg border border-base-300 bg-base-200/40 p-3.5"
          >
            <div className="grid size-9 shrink-0 place-items-center rounded-md border border-base-300 bg-base-100">
              <GoogleSearchConsoleLogo className="size-5" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate font-mono text-sm">{connection.siteUrl}</p>
              <p className="truncate text-xs text-base-content/55">
                {connection.domain}
                {connection.connectedByEmail
                  ? ` · ${connection.connectedByEmail}`
                  : ""}
              </p>
            </div>
            <button
              type="button"
              className="btn btn-ghost btn-sm text-error hover:bg-error/10"
              onClick={() => onDisconnect(connection.domain)}
              disabled={disconnectingDomain !== null}
            >
              {disconnectingDomain === connection.domain
                ? "Removing…"
                : "Remove"}
            </button>
          </div>
        ))}
      </div>
      <div className="flex items-center gap-1">
        <button type="button" className="btn btn-ghost btn-sm" onClick={onAdd}>
          Add property
        </button>
      </div>
    </div>
  );
}
