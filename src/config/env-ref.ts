// src/config/env-ref.ts
//
// Single source of truth for the `${VAR_NAME}` env-ref pattern as used in
// scry's config file and .scry.env. The regex is exported in two shapes:
//
//   - ENV_REF_RE — anchored, capturing. Use to test whether a string is
//     EXACTLY one ref of the form `${VAR_NAME}`, and to extract the name.
//   - isEnvRef(s) — convenience wrapper returning a boolean.
//   - parseEnvRef(s) — returns the captured name, or null if not a ref.
//
// VAR_NAME shape: starts with an uppercase letter, contains only A-Z, 0-9,
// and underscore. This matches the convention used everywhere a user
// declares an env var in `.scry.env` or as a ref in config (e.g.,
// `${ANTHROPIC_AUTH_TOKEN}`).
//
// NOT to be confused with `resolveEnvVars` in loader.ts, which performs
// substitution on whole-config strings and intentionally allows a more
// permissive ref shape because it's recursive on arbitrary user values.

export const ENV_REF_RE = /^\$\{([A-Z][A-Z0-9_]*)\}$/;

export function isEnvRef(s: string): boolean {
  return ENV_REF_RE.test(s);
}

export function parseEnvRef(s: string): string | null {
  const m = ENV_REF_RE.exec(s);
  return m ? m[1] : null;
}
