interface RouteConfig {
  bg: "bg-bg-1" | "bg-bg-white";
  title?: string;
  hideSearch?: boolean;
  hideNotifications?: boolean;
  appbarType?: "default" | "teamDetail" | "userDetail" | "createProject";
}

const ROUTE_CONFIGS: Record<string, RouteConfig> = {
  "/teams": {
    bg: "bg-bg-1",
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

  // Check /projects/create
  if (pathname === "/projects/create") {
    return {
      bg: "bg-bg-white",
      hideSearch: true,
      hideNotifications: true,
      appbarType: "createProject",
    };
  }

  // Check /teams/[id] pattern
  if (/^\/teams\/[^/]+$/.test(pathname)) {
    return {
      bg: "bg-bg-1",
      hideSearch: true,
      hideNotifications: true,
      appbarType: "teamDetail",
    };
  }

  // Check /users/[id] pattern
  if (/^\/users\/[^/]+$/.test(pathname)) {
    return {
      bg: "bg-bg-1",
      hideSearch: true,
      hideNotifications: true,
      appbarType: "userDetail",
    };
  }

  return DEFAULT_CONFIG;
}
