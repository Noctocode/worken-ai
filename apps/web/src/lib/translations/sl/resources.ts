import type { resources as resourcesEn } from "../en/resources";

export const resources: Record<keyof typeof resourcesEn, string> = {
  'toolkit.title': 'Toolkit',
  'toolkit.subtitle': 'Prompti, bližnjice in veščine, ki jih sestaviš enkrat in znova uporabljaš — vsakodnevni gradniki, ki oblikujejo, kako asistent dela za tvojo ekipo.',
  'toolkit.promptsHeading': 'Prompti',
  'toolkit.reusableHeading': 'Bližnjice in veščine',
  'learning.title': 'Viri & Učenje',
  'learning.subtitle': 'Spoznaj platformo in izboljšaj svoje prompte — začni s tem, kako deluje WorkenAI, nato se poglobi v Akademijo.',
  'learning.heroOverview': 'Pregled platforme',
  'learning.heroLessons': 'Vodene lekcije',
  'learning.heroBest': 'Najboljše prakse',
  'toolkit.lib.desc': 'Dostop do vnaprej pripravljenih, produkcijskih promptov za pogoste naročilniške procese.',
  'toolkit.lib.b1': '150+ poslovnih predlog',
  'toolkit.lib.b2': 'Kopiraj in prilagodi v hipu',
  'toolkit.lib.b3': 'Organizacija po kategorijah',
  'toolkit.lib.b4': 'Vključeni primeri uporabe',
  'toolkit.builder.desc': 'Oblikuj učinkovite prompte iz poslovnih predlog za naročilniške procese.',
  'toolkit.builder.b1': 'Vnaprej pripravljene predloge',
  'toolkit.builder.b2': 'Sistem upravljanja spremenljivk',
  'toolkit.builder.b3': 'Nastavitev parametrov',
  'toolkit.builder.b4': 'Predogled in testiranje v realnem času',
  'toolkit.improver.desc': 'Izboljšaj obstoječe prompte z analizo in predlogi optimizacije z AI.',
  'toolkit.improver.b1': 'Analiza z AI',
  'toolkit.improver.b2': 'Izboljšave jasnosti',
  'toolkit.improver.b3': 'Optimizacija natančnosti',
  'toolkit.improver.b4': 'Primerjava drug ob drugem',
  'toolkit.shortcuts.desc': 'Shrani kratke odlomke besedila in makre za vstavljanje v urejevalnik z enim klikom.',
  'toolkit.shortcuts.b1': 'Večkrat uporabni odlomki',
  'toolkit.shortcuts.b2': 'Hiter pojavni meni iz urejevalnika',
  'toolkit.shortcuts.b3': 'Neobvezen filter kategorij',
  'toolkit.shortcuts.b4': 'Do 500 znakov na bližnjico',
  'toolkit.skills.desc': 'Zajemi, kako tvoja ekipa opravi nalogo; asistent jo samodejno uporabi, ko se ujema.',
  'toolkit.skills.b1': 'Zajemi način dela ekipe',
  'toolkit.skills.b2': 'Samodejno ob ujemanju sporočila',
  'toolkit.skills.b3': 'Ostane aktivno skozi pogovor',
  'toolkit.skills.b4': 'Uvoz iz SKILL.md',
  'learning.how.desc': 'Oglej si arhitekturo platforme in tri načine namestitve WorkenAI.',
  'learning.how.b1': 'Lokalna namestitev (on-premise)',
  'learning.how.b2': 'Hibridna namestitev',
  'learning.how.b3': 'Oblak / upravljano',
  'learning.how.b4': 'Vizualni diagrami arhitekture',
  'learning.academy.desc': 'Obvladaj pisanje promptov s kuriranimi lekcijami in poslovnimi najboljšimi praksami.',
  'learning.academy.b1': 'Strukturirane učne poti',
  'learning.academy.b2': 'Poslovne študije primerov',
  'learning.academy.b3': 'Okviri najboljših praks',
  'learning.academy.b4': 'Interaktivne vaje',
  'learning.video.title': 'Video vodiči',
  'learning.video.desc': 'Video vodiči po korakih za WorkenAI — funkcije se nauči z gledanjem.',
  'learning.video.b1': 'Vodeni sprehodi po izdelku',
  'learning.video.b2': 'Poglobljeni pregledi funkcij',
  'learning.video.b3': 'Nasveti in najboljše prakse',
  'learning.video.b4': 'Redno dodajamo nove videe',
  'resources.title': 'Prompt Engineering Hub',
  'resources.subtitle': 'Dostopajte do orodij in virov za gradnjo, optimizacijo in obvladovanje promptov AI za naročilniške procese. Zasnovano za ekipe Fortune 500.',
  'resources.enterpriseTemplates': 'Poslovne predloge',
  'resources.aiPoweredAnalysis': 'Analiza z AI',
  'resources.bestPractices': 'Najboljše prakse',
  'resources.promptLibrary': 'Knjižnica promptov',
  'resources.promptBuilder': 'Graditelj promptov',
  'resources.promptImprover': 'Izboljšalnik promptov',
  'resources.learnAcademy': 'Akademija učenja',
  'resources.shortcuts': 'Bližnjice',
  'resources.skills': 'Veščine',
  'resources.skills.cardDesc':
    'Enkrat zapišite, kako vaša ekipa opravi nalogo; pomočnik jo samodejno uporabi, ko se prilega.',
  'resources.openTool': 'Odpri orodje',
  'resources.comingSoon': 'Kmalu na voljo',

  // Kako deluje WorkenAI (vizualni pregled postavitve)
  'resources.howItWorks': 'Kako deluje WorkenAI',
  'resources.how.cardDesc':
    'Oglejte si arhitekturo platforme in tri načine postavitve WorkenAI.',
  'resources.how.intro':
    'WorkenAI se prilagodi vašim potrebam po suverenosti podatkov in proračunu. Izberite enega od treh načinov postavitve.',
  'resources.how.onprem.title': 'Na lokaciji (on-premise)',
  'resources.how.onprem.caption':
    'Aplikacija, podatki in model tečejo znotraj vaše mreže — nič ne zapusti vaše meje.',
  'resources.how.onprem.cost': 'Strošek: vaša strojna oprema/GPU + licenca; brez per-token provizije.',
  'resources.how.hybrid.title': 'Hibridno',
  'resources.how.hybrid.caption':
    'Aplikacija in podatki ostanejo pri vas; ven gre le prompt za inference prek vašega ključa (BYOK) ali našega prehoda.',
  'resources.how.hybrid.cost': 'Strošek: lažja infra (brez GPU) + per-token poraba.',
  'resources.how.cloud.title': 'Oblak / Upravljano',
  'resources.how.cloud.caption':
    'V celoti gostuje WorkenAI — najhitrejša vzpostavitev, samodejne posodobitve in skaliranje.',
  'resources.how.cloud.cost': 'Strošek: naročnina na sedež ali porabo.',
  'resources.how.label.infra': 'Vaša infrastruktura',
  'resources.how.label.cloud': 'WorkenAI oblak',
  'resources.how.label.app': 'Aplikacija + orkestracija',
  'resources.how.label.data': 'Podatki + embeddingi',
  'resources.how.label.model': 'Model',
  'resources.how.label.external': 'Vaš ponudnik (BYOK) ali naš prehod',

  // Pregled sistema — preproste sheme, kako je celotna aplikacija sestavljena.
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
};
