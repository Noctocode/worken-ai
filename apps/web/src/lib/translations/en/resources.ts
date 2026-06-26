export const resources = {
  // Toolkit + Learning landing heroes (the old /resources hub split in two).
  'toolkit.title': 'Toolkit',
  'toolkit.subtitle': 'Prompts, shortcuts and skills you build once and reuse — the everyday building blocks that shape how the assistant works for your team.',
  'toolkit.promptsHeading': 'Prompts',
  'toolkit.reusableHeading': 'Shortcuts & Skills',
  'learning.title': 'Resources & Learning',
  'learning.subtitle': 'Get to know the platform and level up your prompting — start with how WorkenAI works, then dive into the Academy.',
  // Learning hero chips.
  'learning.heroOverview': 'Platform overview',
  'learning.heroLessons': 'Guided lessons',
  'learning.heroBest': 'Best practices',
  // Toolkit card copy.
  'toolkit.lib.desc': 'Access pre-built, production-ready prompts for common procurement workflows.',
  'toolkit.lib.b1': '150+ enterprise templates',
  'toolkit.lib.b2': 'Copy & customize instantly',
  'toolkit.lib.b3': 'Category-based organization',
  'toolkit.lib.b4': 'Usage examples included',
  'toolkit.builder.desc': 'Design effective prompts from enterprise templates designed for procurement workflows.',
  'toolkit.builder.b1': 'Pre-built procurement templates',
  'toolkit.builder.b2': 'Variable management system',
  'toolkit.builder.b3': 'Parameter configuration',
  'toolkit.builder.b4': 'Real-time preview & testing',
  'toolkit.improver.desc': 'Enhance existing prompts with AI-powered analysis and optimization suggestions.',
  'toolkit.improver.b1': 'AI-powered analysis',
  'toolkit.improver.b2': 'Clarity improvements',
  'toolkit.improver.b3': 'Specificity optimization',
  'toolkit.improver.b4': 'Side-by-side comparison',
  'toolkit.shortcuts.desc': 'Save short text snippets and macros to drop into the composer in one click.',
  'toolkit.shortcuts.b1': 'Reusable text fragments',
  'toolkit.shortcuts.b2': 'Quick popover from the composer',
  'toolkit.shortcuts.b3': 'Optional category filter',
  'toolkit.shortcuts.b4': 'Up to 500 characters per shortcut',
  'toolkit.skills.desc': 'Capture how your team does a task once; the assistant applies it automatically when it fits.',
  'toolkit.skills.b1': 'Capture how your team does a task',
  'toolkit.skills.b2': 'Auto-applied when a message fits',
  'toolkit.skills.b3': 'Stays active across a conversation',
  'toolkit.skills.b4': 'Import from SKILL.md',
  // Learning card copy.
  'learning.how.desc': 'See the platform architecture and the three ways WorkenAI can be deployed.',
  'learning.how.b1': 'On-premise deployment',
  'learning.how.b2': 'Hybrid deployment',
  'learning.how.b3': 'Cloud / managed',
  'learning.how.b4': 'Visual architecture diagrams',
  'learning.academy.desc': 'Master prompt engineering with curated lessons and enterprise best practices.',
  'learning.academy.b1': 'Structured learning paths',
  'learning.academy.b2': 'Enterprise case studies',
  'learning.academy.b3': 'Best practice frameworks',
  'learning.academy.b4': 'Interactive exercises',
  'learning.video.title': 'Video Tutorials',
  'learning.video.desc': 'Step-by-step video walkthroughs of WorkenAI — learn features by watching.',
  'learning.video.b1': 'Guided product walkthroughs',
  'learning.video.b2': 'Feature deep-dives',
  'learning.video.b3': 'Tips & best practices',
  'learning.video.b4': 'New videos added regularly',
  'resources.title': 'Prompt Engineering Hub',
  'resources.subtitle': 'Access enterprise-grade tools and resources to build, optimize, and master AI prompts for procurement workflows. Designed specifically for Fortune 500 teams.',
  'resources.enterpriseTemplates': 'Enterprise Templates',
  'resources.aiPoweredAnalysis': 'AI-Powered Analysis',
  'resources.bestPractices': 'Best Practices',
  'resources.promptLibrary': 'Prompt Library',
  'resources.promptBuilder': 'Prompt Builder',
  'resources.promptImprover': 'Prompt Improver',
  'resources.learnAcademy': 'Learn Academy',
  'resources.shortcuts': 'Shortcuts',
  'resources.skills': 'Skills',
  'resources.skills.cardDesc':
    'Capture how your team does a task once; the assistant applies it automatically when it fits.',
  'resources.openTool': 'Open Tool',
  'resources.comingSoon': 'Coming soon',

  // How WorkenAI works (visual deployment overview)
  'resources.howItWorks': 'How WorkenAI works',
  'resources.how.cardDesc':
    'See the platform architecture and the three ways WorkenAI can be deployed.',
  'resources.how.intro':
    'WorkenAI adapts to your data-sovereignty needs and budget. Choose one of three deployment models.',
  'resources.how.onprem.title': 'On-premise',
  'resources.how.onprem.caption':
    'App, data and the model all run inside your network — nothing leaves your boundary.',
  'resources.how.onprem.cost': 'Cost: your hardware/GPU + license; no per-token gateway fee.',
  'resources.how.hybrid.title': 'Hybrid',
  'resources.how.hybrid.caption':
    'App and data stay on your infrastructure; only the prompt is sent out for inference via your own key (BYOK) or our gateway.',
  'resources.how.hybrid.cost': 'Cost: light infra (no GPU) + per-token usage.',
  'resources.how.cloud.title': 'Cloud / Managed',
  'resources.how.cloud.caption':
    'Fully hosted by WorkenAI — fastest setup, automatic updates and scaling.',
  'resources.how.cloud.cost': 'Cost: per-seat or usage subscription.',
  'resources.how.label.infra': 'Your infrastructure',
  'resources.how.label.cloud': 'WorkenAI cloud',
  'resources.how.label.app': 'App + Orchestration',
  'resources.how.label.data': 'Data + Embeddings',
  'resources.how.label.model': 'Model',
  'resources.how.label.external': 'Your provider (BYOK) or our gateway',

  // System overview — simple diagrams of how the whole app fits together.
  'resources.overview.heading': 'How the system fits together',
  'resources.overview.intro':
    'Simple diagrams of the main building blocks and how they connect.',
  'resources.overview.devOnly':
    'Internal — visible only to @noctocode.com members (developers).',
  'resources.overview.tab.nav': 'Navigation',
  'resources.overview.tab.architecture': 'Architecture',
  'resources.overview.tab.entities': 'Entities & relationships',
  'resources.overview.tab.roles': 'Roles & access',
  'resources.overview.tab.flow': 'Key flow',

  // Tab descriptions
  'resources.overview.nav.desc':
    'The left sidebar is the main navigation, grouped into three sections. Admins also see governance settings (Guardrails, company settings).',
  'resources.overview.architecture.desc':
    'The browser app talks to a single API. The API stores data in PostgreSQL (with vector search) and uses Redis for limits and caching, and it calls external services for AI and documents.',
  'resources.overview.entities.desc':
    'A company contains teams, teams contain projects, and chats (conversations → messages) happen inside a project. Users are members at each level; knowledge files and provider keys attach to projects and teams.',
  'resources.overview.roles.desc':
    'An org role (admin / advanced / basic) sets what a user can do globally. Membership roles set access on a team or project. Settings such as web search and budget cascade from company to team to project.',
  'resources.overview.flow.desc':
    'Every message passes through safety and context steps before and after the AI model: input checks, knowledge + skills, a budget check, the model (which may call tools), output checks, then saving and analytics.',

  // Navigation diagram — group titles (page names reuse sidebar.nav.*)
  'resources.overview.nav.core': 'Core',
  'resources.overview.nav.features': 'Features',
  'resources.overview.nav.tools': 'Tools & Learning',

  // Architecture diagram
  'resources.overview.arch.browser': 'Browser (web app)',
  'resources.overview.arch.api': 'API (server)',
  'resources.overview.arch.dataLane': 'Data',
  'resources.overview.arch.db': 'PostgreSQL + vector search',
  'resources.overview.arch.cache': 'Redis — cache & limits',
  'resources.overview.arch.externalLane': 'External services',
  'resources.overview.arch.models': 'AI models / providers',
  'resources.overview.arch.cloud': 'Cloud sources (Drive, OneDrive, SharePoint, Confluence)',
  'resources.overview.arch.arso': 'ARSO (weather, air, water)',

  // Entities diagram
  'resources.overview.ent.company': 'Company',
  'resources.overview.ent.team': 'Team',
  'resources.overview.ent.project': 'Project',
  'resources.overview.ent.conversation': 'Conversation',
  'resources.overview.ent.message': 'Message',
  'resources.overview.ent.users': 'Users — members at each level',
  'resources.overview.ent.attached': 'Knowledge files · Integrations / keys',

  // Roles diagram
  'resources.overview.roles.orgLane': 'Org roles (global)',
  'resources.overview.roles.admin': 'admin',
  'resources.overview.roles.advanced': 'advanced',
  'resources.overview.roles.basic': 'basic',
  'resources.overview.roles.scopeLane': 'Scope & inheritance',
  'resources.overview.roles.cascade': 'Settings cascade (web search)',
  'resources.overview.roles.teamRoles': 'Team: owner / editor / viewer',
  'resources.overview.roles.projectRoles': 'Project: editor / viewer',

  // Flow diagram — pipeline steps
  'resources.overview.flow.message': 'Message',
  'resources.overview.flow.inputGuard': 'Input guardrail',
  'resources.overview.flow.context': 'Context (knowledge + skills)',
  'resources.overview.flow.budget': 'Budget check',
  'resources.overview.flow.model': 'AI model (+ tools)',
  'resources.overview.flow.outputGuard': 'Output guardrail',
  'resources.overview.flow.save': 'Save + analytics',
  'resources.overview.flow.answer': 'Answer',

  // Enriched detail — node sub-captions, cardinality & extra nodes
  'resources.overview.nav.coreSub': 'day-to-day work',
  'resources.overview.nav.featuresSub': 'workflows',
  'resources.overview.nav.toolsSub': 'helpers & docs',
  'resources.overview.nav.adminLane': 'Admin only',
  'resources.overview.nav.guardrails': 'Guardrails',
  'resources.overview.nav.companySettings': 'Company settings',

  'resources.overview.arch.browserSub': 'Next.js, SSE streaming',
  'resources.overview.arch.apiSub': 'auth · guardrails · RAG · orchestration',
  'resources.overview.arch.dbSub': 'documents + embeddings',
  'resources.overview.arch.cacheSub': 'rate limits, reservations',
  'resources.overview.arch.modelsSub': 'BYOK or managed gateway',
  'resources.overview.arch.arsoSub': 'public environmental data',

  'resources.overview.ent.cardMany': '1 → many',
  'resources.overview.ent.projectSub': 'model, members',
  'resources.overview.ent.conversationSub': 'personal / team',
  'resources.overview.ent.knowledge': 'Knowledge files',
  'resources.overview.ent.integrations': 'Integrations / keys',
  'resources.overview.ent.docs': 'Documents + embeddings',

  'resources.overview.roles.adminSub': 'company, teams, guardrails',
  'resources.overview.roles.advancedSub': 'create projects, invite',
  'resources.overview.roles.basicSub': 'chat in assigned projects',
  'resources.overview.roles.budgetCascade': 'Budget cascade (company → team → member)',

  'resources.overview.flow.inputGuardSub': 'block / redact',
  'resources.overview.flow.contextSub': 'project · KC · skills',
  'resources.overview.flow.modelSub': 'tools: web · ARSO',
  'resources.overview.flow.outputGuardSub': 'block / fix',
  'resources.overview.flow.saveSub': 'message · cost · analytics',
} as const;
