interface RouteConfig {
  bg: "bg-bg-1" | "bg-bg-white";
  title?: string;
  hideSearch?: boolean;
  hideNotifications?: boolean;
  appbarType?: "default" | "teamDetail";
}

const ROUTE_CONFIGS: Record<string, RouteConfig> = {
  "/teams": {
    bg: "bg-bg-white",
    title: "Management",
    hideSearch: true,
    hideNotifications: true,
  },
};

const DEFAULT_CONFIG: RouteConfig = {
  bg: "bg-bg-1",
};

export function getRouteConfig(pathname: string): RouteConfig {
  // Check exact match first
  if (ROUTE_CONFIGS[pathname]) return ROUTE_CONFIGS[pathname];

  // Check /teams/[id] pattern
  if (/^\/teams\/[^/]+$/.test(pathname)) {
    return {
      bg: "bg-bg-white",
      hideSearch: true,
      hideNotifications: true,
      appbarType: "teamDetail",
    };
  }

  return DEFAULT_CONFIG;
}
