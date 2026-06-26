// Internal-only system-overview copy. Lives in this module — which is
// imported solely by system-overview.tsx (loaded via next/dynamic and
// gated on user.isInternal) — so it ships ONLY in that lazy chunk and is
// never downloaded by non-internal users. Do NOT move these strings into
// the global en/sl translation bundles (those are eagerly imported and
// would leak the internal docs to every client).
import type { Language } from "@/lib/i18n";

const OVERVIEW_EN = {
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

  // Per-tab "good to know" bullet points (shown under each diagram)
  'resources.overview.keyPoints': 'Good to know',
  'resources.overview.nav.p1': 'The left sidebar is the only top-level navigation.',
  'resources.overview.nav.p2':
    "Personal profiles see 'Management' instead of 'Team Management'.",
  'resources.overview.nav.p3':
    'Guardrails and company settings are admin-only.',
  'resources.overview.architecture.p1':
    'A single API backs the web app (and any future clients).',
  'resources.overview.architecture.p2':
    'Postgres + pgvector powers semantic search over your knowledge.',
  'resources.overview.architecture.p3':
    'AI calls use your own keys (BYOK) or a managed gateway.',
  'resources.overview.entities.p1':
    'One company has many teams; a team has many projects.',
  'resources.overview.entities.p2':
    'A conversation is scoped either to you or to a team.',
  'resources.overview.entities.p3':
    'Knowledge files and provider keys can be shared per team or project.',
  'resources.overview.roles.p1':
    'The org role is global; team and project roles are per membership.',
  'resources.overview.roles.p2':
    'Web search and budget limits inherit company → team → project.',
  'resources.overview.roles.p3':
    'Guardrails apply org-wide or only to selected teams.',
  'resources.overview.flow.p1':
    'Input and output guardrails wrap every message.',
  'resources.overview.flow.p2':
    'Context is built from project docs, Knowledge Core and skills.',
  'resources.overview.flow.p3':
    'The budget is re-checked before each tool call; everything is logged.',

  // ── Extra reference sections, shown below the tabs ────────────
  // Tech stack
  'resources.overview.stack.heading': 'Tech stack',
  'resources.overview.stack.intro':
    'The main libraries and services the platform runs on.',
  'resources.overview.stack.frontend': 'Frontend',
  'resources.overview.stack.backend': 'Backend',
  'resources.overview.stack.data': 'Data & cache',
  'resources.overview.stack.tooling': 'Tooling',

  // Glossary
  'resources.overview.glossary.heading': 'Glossary',
  'resources.overview.glossary.intro':
    'Shorthand used across these diagrams and the product.',
  'resources.overview.glossary.byok': 'BYOK',
  'resources.overview.glossary.byokDef':
    'Bring your own key — AI calls are billed to your own provider account.',
  'resources.overview.glossary.gateway': 'Managed gateway',
  'resources.overview.glossary.gatewayDef':
    'Built-in AI access used when a model has no BYOK key.',
  'resources.overview.glossary.rag': 'RAG',
  'resources.overview.glossary.ragDef':
    'Retrieval-augmented generation — relevant knowledge files are pulled in as context.',
  'resources.overview.glossary.guardrail': 'Guardrail',
  'resources.overview.glossary.guardrailDef':
    'An admin rule that blocks or redacts message input or output.',
  'resources.overview.glossary.kc': 'Knowledge Core',
  'resources.overview.glossary.kcDef':
    'Uploaded and cloud-imported documents, embedded for semantic search.',
  'resources.overview.glossary.skill': 'Skill',
  'resources.overview.glossary.skillDef':
    'Task-specific instructions automatically applied to a chat when relevant.',
  'resources.overview.glossary.scope': 'Scope cascade',
  'resources.overview.glossary.scopeDef':
    'Settings and budgets inherited from company to team to project.',
  'resources.overview.glossary.observability': 'Observability',
  'resources.overview.glossary.observabilityDef':
    'Per-call logging of tokens, cost and latency for analytics.',
} as const;

export type OverviewKey = keyof typeof OVERVIEW_EN;

const OVERVIEW_SL: Record<OverviewKey, string> = {
  'resources.overview.heading': 'Kako je sistem sestavljen',
  'resources.overview.intro':
    'Preproste sheme glavnih gradnikov in kako so med sabo povezani.',
  'resources.overview.devOnly':
    'Interno — vidno samo članom @noctocode.com (razvijalci).',
  'resources.overview.tab.nav': 'Navigacija',
  'resources.overview.tab.architecture': 'Arhitektura',
  'resources.overview.tab.entities': 'Entitete in povezave',
  'resources.overview.tab.roles': 'Vloge in dostop',
  'resources.overview.tab.flow': 'Ključni tok',

  // Opisi zavihkov
  'resources.overview.nav.desc':
    'Levi meni je glavna navigacija, razdeljena v tri sklope. Admini vidijo še nastavitve nadzora (Guardrails, nastavitve podjetja).',
  'resources.overview.architecture.desc':
    'Spletna aplikacija komunicira z enim API-jem. API hrani podatke v PostgreSQL (z vektorskim iskanjem) in uporablja Redis za limite in predpomnjenje, za AI in dokumente pa kliče zunanje storitve.',
  'resources.overview.entities.desc':
    'Podjetje vsebuje ekipe, ekipe vsebujejo projekte, pogovori (pogovor → sporočila) pa tečejo znotraj projekta. Uporabniki so člani na vsaki ravni; datoteke znanja in ključi ponudnikov se vežejo na projekte in ekipe.',
  'resources.overview.roles.desc':
    'Org vloga (admin / advanced / basic) določa, kaj uporabnik lahko počne globalno. Članske vloge določajo dostop na ekipi ali projektu. Nastavitve, kot sta iskanje po spletu in proračun, se dedujejo od podjetja na ekipo in projekt.',
  'resources.overview.flow.desc':
    'Vsako sporočilo gre skozi varnostne in kontekstne korake pred in po AI modelu: vhodne preverbe, znanje + veščine, preverbo proračuna, model (ki lahko kliče orodja), izhodne preverbe ter shranjevanje in analitiko.',

  // Diagram navigacije — naslovi skupin (imena strani uporabijo sidebar.nav.*)
  'resources.overview.nav.core': 'Jedro',
  'resources.overview.nav.features': 'Funkcije',
  'resources.overview.nav.tools': 'Orodja in učenje',

  // Diagram arhitekture
  'resources.overview.arch.browser': 'Brskalnik (spletna aplikacija)',
  'resources.overview.arch.api': 'API (strežnik)',
  'resources.overview.arch.dataLane': 'Podatki',
  'resources.overview.arch.db': 'PostgreSQL + vektorsko iskanje',
  'resources.overview.arch.cache': 'Redis — predpomnilnik in limiti',
  'resources.overview.arch.externalLane': 'Zunanje storitve',
  'resources.overview.arch.models': 'AI modeli / ponudniki',
  'resources.overview.arch.cloud': 'Cloud viri (Drive, OneDrive, SharePoint, Confluence)',
  'resources.overview.arch.arso': 'ARSO (vreme, zrak, voda)',

  // Diagram entitet
  'resources.overview.ent.company': 'Podjetje',
  'resources.overview.ent.team': 'Ekipa',
  'resources.overview.ent.project': 'Projekt',
  'resources.overview.ent.conversation': 'Pogovor',
  'resources.overview.ent.message': 'Sporočilo',
  'resources.overview.ent.users': 'Uporabniki — člani na vsaki ravni',
  'resources.overview.ent.attached': 'Datoteke znanja · Integracije / ključi',

  // Diagram vlog
  'resources.overview.roles.orgLane': 'Org vloge (globalno)',
  'resources.overview.roles.admin': 'admin',
  'resources.overview.roles.advanced': 'advanced',
  'resources.overview.roles.basic': 'basic',
  'resources.overview.roles.scopeLane': 'Obseg in dedovanje',
  'resources.overview.roles.cascade': 'Kaskada nastavitev (iskanje po spletu)',
  'resources.overview.roles.teamRoles': 'Ekipa: owner / editor / viewer',
  'resources.overview.roles.projectRoles': 'Projekt: editor / viewer',

  // Diagram toka — koraki
  'resources.overview.flow.message': 'Sporočilo',
  'resources.overview.flow.inputGuard': 'Vhodni guardrail',
  'resources.overview.flow.context': 'Kontekst (znanje + veščine)',
  'resources.overview.flow.budget': 'Preverba proračuna',
  'resources.overview.flow.model': 'AI model (+ orodja)',
  'resources.overview.flow.outputGuard': 'Izhodni guardrail',
  'resources.overview.flow.save': 'Shrani + analitika',
  'resources.overview.flow.answer': 'Odgovor',

  // Razširjen detajl — podnapisi vozlišč, števnost in dodatna vozlišča
  'resources.overview.nav.coreSub': 'vsakodnevno delo',
  'resources.overview.nav.featuresSub': 'delovni tokovi',
  'resources.overview.nav.toolsSub': 'pripomočki in dokumentacija',
  'resources.overview.nav.adminLane': 'Samo admin',
  'resources.overview.nav.guardrails': 'Guardrails',
  'resources.overview.nav.companySettings': 'Nastavitve podjetja',

  'resources.overview.arch.browserSub': 'Next.js, SSE pretok',
  'resources.overview.arch.apiSub': 'avtentikacija · guardraili · RAG · orkestracija',
  'resources.overview.arch.dbSub': 'dokumenti + embeddingi',
  'resources.overview.arch.cacheSub': 'limiti, rezervacije',
  'resources.overview.arch.modelsSub': 'BYOK ali upravljani prehod',
  'resources.overview.arch.arsoSub': 'javni okoljski podatki',

  'resources.overview.ent.cardMany': '1 → več',
  'resources.overview.ent.projectSub': 'model, člani',
  'resources.overview.ent.conversationSub': 'osebni / ekipni',
  'resources.overview.ent.knowledge': 'Datoteke znanja',
  'resources.overview.ent.integrations': 'Integracije / ključi',
  'resources.overview.ent.docs': 'Dokumenti + embeddingi',

  'resources.overview.roles.adminSub': 'podjetje, ekipe, guardrails',
  'resources.overview.roles.advancedSub': 'ustvari projekte, vabi',
  'resources.overview.roles.basicSub': 'klepet v dodeljenih projektih',
  'resources.overview.roles.budgetCascade': 'Kaskada proračuna (podjetje → ekipa → član)',

  'resources.overview.flow.inputGuardSub': 'blokira / cenzurira',
  'resources.overview.flow.contextSub': 'projekt · KC · veščine',
  'resources.overview.flow.modelSub': 'orodja: splet · ARSO',
  'resources.overview.flow.outputGuardSub': 'blokira / popravi',
  'resources.overview.flow.saveSub': 'sporočilo · strošek · analitika',

  // Točke "dobro je vedeti" za vsak zavihek (pod diagramom)
  'resources.overview.keyPoints': 'Dobro je vedeti',
  'resources.overview.nav.p1': 'Levi meni je edina glavna navigacija.',
  'resources.overview.nav.p2':
    "Osebni profili vidijo 'Upravljanje' namesto 'Upravljanje ekip'.",
  'resources.overview.nav.p3':
    'Guardrails in nastavitve podjetja so samo za admine.',
  'resources.overview.architecture.p1':
    'En sam API streže spletni aplikaciji (in morebitnim prihodnjim odjemalcem).',
  'resources.overview.architecture.p2':
    'Postgres + pgvector poganja semantično iskanje po vašem znanju.',
  'resources.overview.architecture.p3':
    'AI klici uporabljajo vaše ključe (BYOK) ali upravljani prehod.',
  'resources.overview.entities.p1':
    'Eno podjetje ima več ekip; ekipa ima več projektov.',
  'resources.overview.entities.p2':
    'Pogovor je obsegan na vas ali na ekipo.',
  'resources.overview.entities.p3':
    'Datoteke znanja in ključi se lahko delijo po ekipi ali projektu.',
  'resources.overview.roles.p1':
    'Org vloga je globalna; vloge na ekipi in projektu so po članstvu.',
  'resources.overview.roles.p2':
    'Iskanje po spletu in proračun se dedujejo podjetje → ekipa → projekt.',
  'resources.overview.roles.p3':
    'Guardrails veljajo za celo podjetje ali le za izbrane ekipe.',
  'resources.overview.flow.p1':
    'Vhodni in izhodni guardrail ovijata vsako sporočilo.',
  'resources.overview.flow.p2':
    'Kontekst se sestavi iz projektnih dokumentov, Knowledge Core in veščin.',
  'resources.overview.flow.p3':
    'Proračun se preveri pred vsakim klicem orodja; vse se beleži.',

  // ── Dodatne referenčne sekcije, prikazane pod zavihki ─────────
  // Tehnološki sklad
  'resources.overview.stack.heading': 'Tehnološki sklad',
  'resources.overview.stack.intro':
    'Glavne knjižnice in storitve, na katerih teče platforma.',
  'resources.overview.stack.frontend': 'Frontend',
  'resources.overview.stack.backend': 'Backend',
  'resources.overview.stack.data': 'Podatki in predpomnilnik',
  'resources.overview.stack.tooling': 'Orodja',

  // Slovarček
  'resources.overview.glossary.heading': 'Slovarček',
  'resources.overview.glossary.intro':
    'Kratice in izrazi, uporabljeni v teh diagramih in izdelku.',
  'resources.overview.glossary.byok': 'BYOK',
  'resources.overview.glossary.byokDef':
    'Lasten ključ — klici AI se zaračunajo na tvoj račun pri ponudniku.',
  'resources.overview.glossary.gateway': 'Upravljani prehod',
  'resources.overview.glossary.gatewayDef':
    'Vgrajen dostop do AI, ki se uporabi, kadar model nima lastnega (BYOK) ključa.',
  'resources.overview.glossary.rag': 'RAG',
  'resources.overview.glossary.ragDef':
    'Generiranje z iskanjem — relevantne datoteke znanja se vključijo v kontekst.',
  'resources.overview.glossary.guardrail': 'Guardrail',
  'resources.overview.glossary.guardrailDef':
    'Administratorsko pravilo, ki blokira ali prikrije vhod ali izhod sporočila.',
  'resources.overview.glossary.kc': 'Knowledge Core',
  'resources.overview.glossary.kcDef':
    'Naloženi in iz oblaka uvoženi dokumenti, vdelani za pomensko iskanje.',
  'resources.overview.glossary.skill': 'Veščina',
  'resources.overview.glossary.skillDef':
    'Opravilu prilagojena navodila, samodejno uporabljena v klepetu, ko so relevantna.',
  'resources.overview.glossary.scope': 'Kaskada obsega',
  'resources.overview.glossary.scopeDef':
    'Nastavitve in proračuni se dedujejo od podjetja na ekipo na projekt.',
  'resources.overview.glossary.observability': 'Opazljivost',
  'resources.overview.glossary.observabilityDef':
    'Beleženje žetonov, stroška in zakasnitve za vsak klic, za analitiko.',
};

/** Overview copy keyed by language; callers fall back to en per key. */
export const OVERVIEW_TEXT: Record<Language, Record<OverviewKey, string>> = {
  en: OVERVIEW_EN,
  sl: OVERVIEW_SL,
};
