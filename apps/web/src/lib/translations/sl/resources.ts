import type { resources as resourcesEn } from "../en/resources";

export const resources: Record<keyof typeof resourcesEn, string> = {
  'toolkit.title': 'Toolkit',
  'toolkit.subtitle': 'Prompti, bližnjice in veščine, ki jih sestaviš enkrat in znova uporabljaš — vsakodnevni gradniki, ki oblikujejo, kako asistent dela za tvojo ekipo.',
  'toolkit.promptsHeading': 'Prompti',
  'toolkit.reusableHeading': 'Bližnjice in veščine',
  'learning.title': 'Viri & Učenje',
  'learning.subtitle': 'Spoznaj platformo in izboljšaj svoje prompte — začni s tem, kako deluje WorkenAI, nato se poglobi v Akademijo.',
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
  'resources.quickStartGuide': 'Vodnik za hitri začetek',
  'resources.openTool': 'Odpri orodje',
  'resources.startWithBuilder': 'Začnite z Graditeljem',
  'resources.optimizeWithImprover': 'Optimizirajte z Izboljšalnikom',
  'resources.learnInAcademy': 'Učite se v Akademiji',
  'resources.enterpriseBestPractices': 'Najboljše prakse inženiringa promptov',

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
};
