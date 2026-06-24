export const tools = {
  "tools.tab": "Orodja",
  "tools.title": "Orodja",
  "tools.desc":
    "Zunanji API-ji, ki jih AI lahko pokliče med klepetom. Nastavljeni enkrat za celo podjetje.",
  "tools.registryNote":
    "Orodja se registrirajo tukaj. Da jih AI lahko kliče v klepetu, uvajamo posebej.",
  "tools.readOnlyNote": "Orodja lahko dodajajo in urejajo le skrbniki podjetja.",
  "tools.add": "Dodaj orodje",
  "tools.empty": "Še ni orodij.",
  "tools.emptyAdmin": 'Dodaj prvo orodje z "Dodaj orodje".',
  "tools.search": "Išči orodja...",
  "tools.enabled": "Omogočeno",
  "tools.disabled": "Onemogočeno",
  "tools.keySet": "Ključ nastavljen",
  "tools.noKey": "Brez ključa",
  "tools.edit": "Uredi",
  "tools.delete": "Izbriši",
  "tools.deleting": "Brisanje...",
  "tools.confirmDeleteTitle": "Izbriši orodje",
  "tools.confirmDelete": "Izbrišem to orodje? Tega ni mogoče razveljaviti.",

  // Dialog
  "tools.createTitle": "Dodaj orodje",
  "tools.editTitle": "Uredi orodje",
  "tools.dialogDesc":
    "Opiši zunanji API, da AI ve, kdaj in kako ga poklicati.",
  "tools.create": "Ustvari",
  "tools.creating": "Ustvarjanje...",
  "tools.save": "Shrani spremembe",
  "tools.saving": "Shranjevanje...",
  "tools.cancel": "Prekliči",

  // Fields
  "tools.field.displayName": "Prikazno ime",
  "tools.field.displayNamePh": "Vreme",
  "tools.field.name": "Ime funkcije",
  "tools.field.namePh": "get_weather",
  "tools.field.nameHint": "Kako jo kliče model — male črke, a–z 0–9 _.",
  "tools.field.description": "Opis",
  "tools.field.descriptionPh":
    "Pridobi trenutno vreme za mesto. Uporabi, ko uporabnik vpraša o vremenu.",
  "tools.field.descriptionHint": "Modelu pove, KDAJ uporabiti to orodje.",
  "tools.field.method": "HTTP metoda",
  "tools.field.url": "URL zahteve",
  "tools.field.urlPh": "https://api.example.com/weather?q={{city}}",
  "tools.field.urlHint": "Samo HTTPS. Za vrednosti uporabi {{param}}.",
  "tools.field.inputSchema": "Parametri (JSON Schema)",
  "tools.field.headers": "Glave (JSON)",
  "tools.field.query": "Query parametri (JSON)",
  "tools.field.body": "Telo (JSON)",
  "tools.field.responsePath": "Pot do odgovora (neobvezno)",
  "tools.field.responsePathPh": "$.main",
  "tools.field.auth": "Avtentikacija",
  "tools.field.authParam": "Ime ključa",
  "tools.field.authParamPh": "appid",
  "tools.field.apiKey": "API ključ",
  "tools.field.apiKeyPh": "Prilepi API ključ",
  "tools.field.apiKeyKept": "Pusti prazno za ohranitev shranjenega ključa.",
  "tools.field.visibility": "Vidnost",
  "tools.field.callLimit": "Mesečna omejitev klicev",
  "tools.field.callLimitPh": "Neomejeno",
  "tools.field.timeout": "Časovna omejitev (ms)",
  "tools.field.isEnabled": "Omogočeno",

  // Auth options
  "tools.auth.none": "Brez",
  "tools.auth.api_key_header": "API ključ v glavi",
  "tools.auth.api_key_query": "API ključ v query",
  "tools.auth.bearer": "Bearer žeton",

  // Visibility options
  "tools.vis.all": "Vsi",
  "tools.vis.admins": "Samo skrbniki",

  // Toasts
  "tools.toast.created": "Orodje ustvarjeno.",
  "tools.toast.updated": "Orodje posodobljeno.",
  "tools.toast.deleted": "Orodje izbrisano.",
  "tools.toast.invalidJson": "Preveri JSON polja — eno ni veljaven JSON.",
} as const;
