import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";

// Meaningful linting is re-enabled. The previous config disabled essentially
// every rule, which made `next lint` a no-op. We keep the noisiest stylistic
// rules relaxed but restore the ones that catch real bugs.
const eslintConfig = [
  ...nextCoreWebVitals,
  ...nextTypescript,
  {
    rules: {
      // Catch real bugs
      "no-unreachable": "error",
      "no-fallthrough": "error",
      "no-redeclare": "error",
      "no-dupe-keys": "error",
      "no-const-assign": "error",
      "react-hooks/exhaustive-deps": "warn",
      // React's own data-fetching/measurement docs use synchronous setState inside
      // effects (loading flags, async results, observer setup). Keep this visible as a
      // warning rather than an error so those idiomatic patterns don't fail the build.
      "react-hooks/set-state-in-effect": "warn",

      // Surface (but don't block on) hygiene issues
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/no-explicit-any": "warn",
      "prefer-const": "warn",
      "no-console": ["warn", { allow: ["warn", "error"] }],

      // Intentionally relaxed for this codebase
      "@typescript-eslint/ban-ts-comment": "off",
      "react/no-unescaped-entities": "off",
      "@next/next/no-img-element": "off",
    },
  },
  {
    // Build/Node tooling scripts may log to stdout.
    files: ["scripts/**"],
    rules: { "no-console": "off" },
  },
  {
    ignores: [
      "node_modules/**",
      ".next/**",
      "out/**",
      "build/**",
      "next-env.d.ts",
      "public/**", // third-party ONNX Runtime assets (copied, minified)
    ],
  },
];

export default eslintConfig;
