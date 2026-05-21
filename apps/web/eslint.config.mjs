import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
  {
    rules: {
      // React 19 / Next 16 promoted these "you might not need an effect"
      // anti-pattern detectors from advisory warnings to hard errors.
      // The flagged sites here (form-prefill from a server-loaded prop,
      // dialog visibility reset on close, page-index clamp when the
      // total page count shrinks) are deliberate seeding/clamping
      // patterns rather than bugs — they render correctly and the
      // alternative (computing-derived-state during render with
      // `useMemo` / key remounts) is a real refactor per call site.
      // Keeping the signal visible as warnings so we can pay it down
      // incrementally without blocking CI on every PR.
      "react-hooks/set-state-in-effect": "warn",
    },
  },
]);

export default eslintConfig;
