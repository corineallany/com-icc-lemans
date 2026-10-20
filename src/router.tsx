import { QueryClient } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";

export const getRouter = () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        // Reuse recent results while navigating; RealtimeQuerySync invalidates
        // the affected keys as soon as the underlying table changes.
        staleTime: 60_000,
        refetchOnMount: true,
        refetchOnWindowFocus: true,
        refetchOnReconnect: true,
        // Do not poll every active query globally. Live updates come from Realtime;
        // polling should be opted into only by the few views that need it.
        refetchInterval: false,
        refetchIntervalInBackground: false,
        retry: 1,
      },
    },
  });
  const viteBase = import.meta.env.BASE_URL || "/";
  const basepath = viteBase === "/" ? "/" : viteBase.replace(/\/$/, "");

  const router = createRouter({
    routeTree,
    basepath,
    context: { queryClient },
    scrollRestoration: true,
    defaultPreload: "intent",
    defaultPreloadStaleTime: 60_000,
  });

  return router;
};
