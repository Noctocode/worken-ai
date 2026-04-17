interface AppbarAction {
  label: string;
  event: string;
}

interface AppbarSearch {
  placeholder: string;
  event: string;
}

interface RouteConfig {
  bg: "bg-bg-1" | "bg-bg-white";
  title?: string;
  hideSearch?: boolean;
  hideNotifications?: boolean;
  appbarType?: "default" | "teamDetail" | "userDetail" | "createProject" | "aiChat" | "projectDetail" | "tenderDetail";
  appbarAction?: AppbarAction;
  appbarSearch?: AppbarSearch;
  appbarExpandControls?: boolean;
}

const ROUTE_CONFIGS: Record<string, RouteConfig> = {
  "/": {
    bg: "bg-bg-1",
    hideSearch: true,
    hideNotifications: true,
    appbarType: "aiChat",
  },
  "/teams": {
    bg: "bg-bg-1",
    title: "Management",
    hideSearch: true,
    hideNotifications: true,
  },
  "/resources": {
    bg: "bg-bg-1",
    title: "Resources & Learning",
    hideSearch: true,
    hideNotifications: true,
  },
  "/resources/prompt-library": {
    bg: "bg-bg-1",
    title: "Prompt Library",
    hideSearch: true,
    hideNotifications: true,
  },
  "/resources/learn-academy": {
    bg: "bg-bg-1",
    title: "Learn Academy",
    hideSearch: true,
    hideNotifications: true,
  },
  "/resources/prompt-builder": {
    bg: "bg-bg-1",
    title: "Prompt Builder",
    hideSearch: true,
    hideNotifications: true,
  },
  "/resources/prompt-improver": {
    bg: "bg-bg-1",
    title: "Prompt Improver",
    hideSearch: true,
    hideNotifications: true,
  },
  "/compare-models": {
    bg: "bg-bg-1",
    title: "Model Arena",
    hideSearch: true,
    hideNotifications: true,
    appbarAction: { label: "New Comparison", event: "compare-models:new" },
  },
  "/tender-ai": {
    bg: "bg-bg-1",
    title: "Tender AI",
    hideSearch: true,
    hideNotifications: true,
    appbarSearch: { placeholder: "Search", event: "tender-ai:search" },
    appbarAction: { label: "Create Tender", event: "tender-ai:create" },
    appbarExpandControls: true,
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

  // Check /projects/[id] pattern (but not /projects/create)
  if (/^\/projects\/[^/]+$/.test(pathname) && pathname !== "/projects/create") {
    return {
      bg: "bg-bg-1",
      hideSearch: true,
      hideNotifications: true,
      appbarType: "projectDetail",
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

  // Check /resources/learn-academy/[slug] pattern
  if (/^\/resources\/learn-academy\/[^/]+$/.test(pathname)) {
    return {
      bg: "bg-bg-1",
      title: "Learn Academy",
      hideSearch: true,
      hideNotifications: true,
    };
  }

  // Check /tender-ai/create
  if (pathname === "/tender-ai/create") {
    return {
      bg: "bg-bg-1",
      hideSearch: true,
      hideNotifications: true,
    };
  }

  // Check /tender-ai/[id] pattern
  if (/^\/tender-ai\/[^/]+$/.test(pathname)) {
    return {
      bg: "bg-bg-white",
      hideSearch: true,
      hideNotifications: true,
      appbarType: "tenderDetail",
    };
  }

  return DEFAULT_CONFIG;
}
