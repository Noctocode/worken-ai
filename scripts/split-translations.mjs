#!/usr/bin/env node
/**
 * One-shot refactor: split the monolithic en.ts / sl.ts translation files
 * into 21 namespace-grouped modules per language plus an index that
 * re-exports the merged record. Run from repo root:
 *
 *   node scripts/split-translations.mjs
 *
 * Safe to re-run: it overwrites the en/ and sl/ folders deterministically.
 * Does NOT touch the source en.ts / sl.ts files; delete those manually
 * after verifying the new structure compiles.
 */

import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const SRC_DIR = path.join(ROOT, "apps/web/src/lib/translations");
const EN_SRC = path.join(SRC_DIR, "en.ts");
const SL_SRC = path.join(SRC_DIR, "sl.ts");

// Namespace prefix → output module file.
// Modules are intentionally chunked by feature folder, not alphabetically.
const NS_TO_MODULE = {
  // common
  common: "common",
  sidebar: "common",
  footer: "common",
  appbar: "common",
  pagination: "common",
  agentGrid: "common",
  dashboard: "common",
  emailTag: "common",
  // auth + invites
  auth: "auth",
  invite: "auth",
  invMem: "auth",
  // onboarding wizard
  onboarding: "onboarding",
  setupSix: "onboarding",
  // management section
  mgmt: "management",
  // knowledge core
  kcFolder: "knowledge",
  knowledgeCore: "knowledge",
  knowledgeMain: "knowledge",
  nameConf: "knowledge",
  visDlg: "knowledge",
  // teams
  teams: "teams",
  teamDetail: "teams",
  teamForm: "teams",
  teamInt: "teams",
  teamPop: "teams",
  memberCap: "teams",
  // users
  userDetail: "users",
  // tenders
  tender: "tenders",
  tenderDetail: "tenders",
  tenderMain: "tenders",
  tenderCreate: "tenders",
  // projects
  projDetail: "projects",
  projectCreate: "projects",
  // arena (compare-models)
  arena: "arena",
  compareModels: "arena",
  addModel: "arena",
  modelSugg: "arena",
  // prompt resources
  promptBuilder: "prompts",
  promptImprover: "prompts",
  promptLibrary: "prompts",
  promptLib: "prompts",
  // shortcuts
  shortcuts: "shortcuts",
  // learn academy
  learnAcademy: "learnAcademy",
  lessonDetail: "learnAcademy",
  // resources hub
  resources: "resources",
  // docs / api
  apiDocs: "docs",
  // google drive
  drive: "drive",
  driveDlg: "drive",
  // observability
  observability: "observability",
  // notifications
  notifications: "notifications",
  notifPop: "notifications",
  // guardrails
  guardrails: "guardrails",
  // chat (project chat)
  chatHist: "chat",
  chatComp: "chat",
  chatEmpty: "chat",
  msgActions: "chat",
  // shared dialogs
  dlg: "dialogs",
  addDoc: "dialogs",
  attach: "dialogs",
};

// All distinct modules, in the order they'll appear in the merged index.
const MODULES = Array.from(new Set(Object.values(NS_TO_MODULE)));

function parseSource(src) {
  // Each meaningful line looks like:   'ns.key': 'value',
  // Skip header (`export const X = {`), trailing `} as const;` / `};`,
  // type exports, and blank lines.
  const lines = src.split("\n");
  const entries = [];
  for (const line of lines) {
    const m = line.match(/^(\s*)('([a-zA-Z]+)\.[a-zA-Z0-9_.$]+'):\s*(.+?),?\s*$/);
    if (!m) continue;
    const [, indent, keyLiteral, namespace, valueWithTrailing] = m;
    // strip trailing comma if regex didn't (it shouldn't, but be safe)
    const value = valueWithTrailing.replace(/,$/, "");
    entries.push({ indent, keyLiteral, namespace, value, raw: line });
  }
  return entries;
}

function groupByModule(entries) {
  const out = Object.fromEntries(MODULES.map((m) => [m, []]));
  const unknown = [];
  for (const e of entries) {
    const mod = NS_TO_MODULE[e.namespace];
    if (!mod) {
      unknown.push(e);
      continue;
    }
    out[mod].push(e);
  }
  return { out, unknown };
}

function renderEnModule(modName, entries) {
  // Variable name = module name (camelCase, since file names use kebab or
  // camel). Map kebab to camel just in case.
  const varName = modName.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
  const body = entries.map((e) => `  ${e.keyLiteral}: ${e.value},`).join("\n");
  return `export const ${varName} = {\n${body}\n} as const;\n`;
}

function renderSlModule(modName, entries) {
  const varName = modName.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
  // Strict typing: SL must cover every key of the EN module.
  // We use Record<keyof typeof xEn, string> so missing keys are a TS error.
  const body = entries.map((e) => `  ${e.keyLiteral}: ${e.value},`).join("\n");
  return `import type { ${varName} as ${varName}En } from "../en/${modName}";

export const ${varName}: Record<keyof typeof ${varName}En, string> = {
${body}
};
`;
}

function renderEnIndex() {
  const imports = MODULES.map((m) => {
    const varName = m.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
    return `import { ${varName} } from "./${m}";`;
  }).join("\n");
  const spreads = MODULES.map((m) => {
    const varName = m.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
    return `  ...${varName},`;
  }).join("\n");
  return `${imports}

export const en = {
${spreads}
} as const;

export type TranslationKey = keyof typeof en;
`;
}

function renderSlIndex() {
  const imports = MODULES.map((m) => {
    const varName = m.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
    return `import { ${varName} } from "./${m}";`;
  }).join("\n");
  const spreads = MODULES.map((m) => {
    const varName = m.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
    return `  ...${varName},`;
  }).join("\n");
  return `import type { TranslationKey } from "../en";
${imports}

export const sl: Record<TranslationKey, string> = {
${spreads}
};
`;
}

function ensureCleanDir(p) {
  fs.rmSync(p, { recursive: true, force: true });
  fs.mkdirSync(p, { recursive: true });
}

function main() {
  const enSrc = fs.readFileSync(EN_SRC, "utf8");
  const slSrc = fs.readFileSync(SL_SRC, "utf8");

  const enEntries = parseSource(enSrc);
  const slEntries = parseSource(slSrc);

  console.log(`Parsed ${enEntries.length} EN entries, ${slEntries.length} SL entries.`);

  // Sanity: both files must have the same key set in the same namespaces.
  const enKeys = new Set(enEntries.map((e) => e.keyLiteral));
  const slKeys = new Set(slEntries.map((e) => e.keyLiteral));
  const onlyEn = [...enKeys].filter((k) => !slKeys.has(k));
  const onlySl = [...slKeys].filter((k) => !enKeys.has(k));
  if (onlyEn.length || onlySl.length) {
    console.error("Key sets diverge:");
    if (onlyEn.length) console.error("  only EN:", onlyEn.slice(0, 5));
    if (onlySl.length) console.error("  only SL:", onlySl.slice(0, 5));
    process.exit(1);
  }

  const { out: enByModule, unknown: enUnknown } = groupByModule(enEntries);
  const { out: slByModule, unknown: slUnknown } = groupByModule(slEntries);

  const allUnknown = [...enUnknown, ...slUnknown];
  if (allUnknown.length) {
    const seen = new Set();
    for (const u of allUnknown) {
      if (!seen.has(u.namespace)) {
        console.error(`Unmapped namespace: ${u.namespace} (example: ${u.keyLiteral})`);
        seen.add(u.namespace);
      }
    }
    process.exit(1);
  }

  const enDir = path.join(SRC_DIR, "en");
  const slDir = path.join(SRC_DIR, "sl");
  ensureCleanDir(enDir);
  ensureCleanDir(slDir);

  let totalEn = 0;
  let totalSl = 0;
  for (const mod of MODULES) {
    const enMod = enByModule[mod];
    const slMod = slByModule[mod];
    totalEn += enMod.length;
    totalSl += slMod.length;
    fs.writeFileSync(path.join(enDir, `${mod}.ts`), renderEnModule(mod, enMod));
    fs.writeFileSync(path.join(slDir, `${mod}.ts`), renderSlModule(mod, slMod));
    console.log(`  ${mod.padEnd(15)} ${String(enMod.length).padStart(4)} keys`);
  }
  fs.writeFileSync(path.join(enDir, "index.ts"), renderEnIndex());
  fs.writeFileSync(path.join(slDir, "index.ts"), renderSlIndex());

  console.log(`Wrote ${MODULES.length} modules + index per language.`);
  console.log(`EN total: ${totalEn}, SL total: ${totalSl}`);
}

main();
