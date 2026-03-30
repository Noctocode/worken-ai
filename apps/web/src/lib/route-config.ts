interface RouteConfig {
  bg: "bg-bg-1" | "bg-bg-white";
  title?: string;
  hideSearch?: boolean;
  hideNotifications?: boolean;
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
  return ROUTE_CONFIGS[pathname] ?? DEFAULT_CONFIG;
}
