import type { TranslationKey } from "@/lib/translations/en";

interface AppbarAction {
  labelKey: TranslationKey;
  event: string;
}

interface AppbarSearch {
  placeholderKey: TranslationKey;
  event: string;
}

interface RouteConfig {
  bg: "bg-bg-1" | "bg-bg-white";
  titleKey?: TranslationKey;
  hideSearch?: boolean;
  hideNotifications?: boolean;
  appbarType?: "default" | "teamDetail" | "userDetail" | "createProject" | "aiChat" | "projectDetail" | "tenderDetail" | "tenderCreate" | "observability";
  appbarAction?: AppbarAction;
  /** Only render the appbar action at lg+ — used where a smaller-width layout
   *  already provides its own in-page action button (e.g. the Model Arena
   *  "+ New" header, which is lg:hidden) so the two never duplicate. */
  appbarActionLgOnly?: boolean;
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
    titleKey: "appbar.title.management",
    hideSearch: true,
    hideNotifications: true,
  },
  "/docs/api": {
    bg: "bg-bg-1",
    titleKey: "appbar.title.apiDocs",
    hideSearch: true,
    hideNotifications: true,
  },
  "/resources": {
    bg: "bg-bg-1",
    titleKey: "appbar.title.resources",
    hideSearch: true,
    hideNotifications: true,
  },
  "/resources/prompt-library": {
    bg: "bg-bg-1",
    titleKey: "appbar.title.promptLibrary",
    hideSearch: true,
    hideNotifications: true,
  },
  "/resources/learn-academy": {
    bg: "bg-bg-1",
    titleKey: "appbar.title.learnAcademy",
    hideSearch: true,
    hideNotifications: true,
  },
  "/resources/prompt-builder": {
    bg: "bg-bg-1",
    titleKey: "appbar.title.promptBuilder",
    hideSearch: true,
    hideNotifications: true,
  },
  "/resources/prompt-improver": {
    bg: "bg-bg-1",
    titleKey: "appbar.title.promptImprover",
    hideSearch: true,
    hideNotifications: true,
  },
  "/resources/shortcuts": {
    bg: "bg-bg-1",
    titleKey: "appbar.title.shortcuts",
    hideSearch: true,
    hideNotifications: true,
  },
  "/resources/how-it-works": {
    bg: "bg-bg-1",
    titleKey: "appbar.title.howItWorks",
    hideSearch: true,
    hideNotifications: true,
  },
  "/guardrails": {
    bg: "bg-bg-white",
    titleKey: "appbar.title.guardrails",
    hideSearch: true,
    hideNotifications: true,
    appbarAction: { labelKey: "appbar.action.addGuardrail", event: "guardrails:add" },
  },
  "/observability": {
    bg: "bg-bg-1",
    titleKey: "appbar.title.observability",
    hideSearch: true,
    hideNotifications: true,
    appbarType: "observability",
  },
  "/notifications": {
    bg: "bg-bg-1",
    titleKey: "appbar.title.notifications",
    hideSearch: true,
    hideNotifications: true,
  },
  "/compare-models": {
    bg: "bg-bg-1",
    titleKey: "appbar.title.modelArena",
    hideSearch: true,
    hideNotifications: true,
    // lg-only: below lg the in-page "+ New" header (lg:hidden) already provides
    // this action, so showing it in the appbar there would duplicate. At lg+
    // the in-page header is gone, so the appbar keeps "New Comparison".
    appbarAction: { labelKey: "appbar.action.newComparison", event: "compare-models:new" },
    appbarActionLgOnly: true,
  },
  "/knowledge-core": {
    bg: "bg-bg-1",
    titleKey: "appbar.title.knowledgeCore",
    hideSearch: true,
    hideNotifications: true,
    appbarSearch: { placeholderKey: "appbar.search.placeholder", event: "knowledge-core:search" },
    appbarExpandControls: true,
  },
  "/ai-cron": {
    bg: "bg-bg-1",
    titleKey: "appbar.title.aiCron",
    hideSearch: true,
    hideNotifications: true,
    appbarAction: { labelKey: "appbar.action.newScheduledPrompt", event: "ai-cron:new" },
  },
  "/tender-ai": {
    bg: "bg-bg-1",
    titleKey: "appbar.title.tenderAI",
    hideSearch: true,
    hideNotifications: true,
    appbarSearch: { placeholderKey: "appbar.search.placeholder", event: "tender-ai:search" },
    appbarAction: { labelKey: "appbar.action.createTender", event: "tender-ai:create" },
    appbarExpandControls: true,
  },
};

const DEFAULT_CONFIG: RouteConfig = {
  bg: "bg-bg-1",
};

export function getRouteConfig(pathname: string): RouteConfig {
  if (ROUTE_CONFIGS[pathname]) return ROUTE_CONFIGS[pathname];

  // AI Cron create/edit are full-form sub-pages on the white canvas; the
  // list at /ai-cron keeps its own ROUTE_CONFIGS entry above.
  if (pathname === "/ai-cron/new" || /^\/ai-cron\/[^/]+\/edit$/.test(pathname)) {
    return {
      bg: "bg-bg-1",
      titleKey: "appbar.title.aiCron",
      hideSearch: true,
      hideNotifications: true,
    };
  }

  if (pathname === "/projects/create") {
    return {
      bg: "bg-bg-white",
      hideSearch: true,
      hideNotifications: true,
      appbarType: "createProject",
    };
  }

  if (/^\/projects\/[^/]+$/.test(pathname) && pathname !== "/projects/create") {
    return {
      bg: "bg-bg-1",
      hideSearch: true,
      hideNotifications: true,
      appbarType: "projectDetail",
    };
  }

  if (/^\/teams\/[^/]+$/.test(pathname)) {
    return {
      bg: "bg-bg-1",
      hideSearch: true,
      hideNotifications: true,
      appbarType: "teamDetail",
    };
  }

  if (/^\/users\/[^/]+$/.test(pathname)) {
    return {
      bg: "bg-bg-1",
      hideSearch: true,
      hideNotifications: true,
      appbarType: "userDetail",
    };
  }

  if (/^\/resources\/learn-academy\/[^/]+$/.test(pathname)) {
    return {
      bg: "bg-bg-1",
      titleKey: "appbar.title.learnAcademy",
      hideSearch: true,
      hideNotifications: true,
    };
  }

  if (/^\/knowledge-core\/[^/]+$/.test(pathname)) {
    return {
      bg: "bg-bg-1",
      titleKey: "appbar.title.knowledgeCore",
      hideSearch: true,
      hideNotifications: true,
    };
  }

  if (pathname === "/tender-ai/create") {
    return {
      bg: "bg-bg-1",
      hideSearch: true,
      hideNotifications: true,
      appbarType: "tenderCreate",
    };
  }

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
