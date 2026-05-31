# scry web frontend — Plan F (Registry editor) — design spec

**Date:** 2026-05-31
**Status:** Draft, pending user approval
**Builds on:** [Plan E spec](./2026-05-29-scry-config-surfaces-ef-design.md), [v2 design](./2026-05-22-scry-web-frontend-v2-design.md)
**Predecessor PR:** [#12 — Plan E](https://github.com/aviralv/scry/pull/12) (merged)

---

## What this spec does

Adds `/registry` — the People + Projects editor — to the scry SPA. Reuses everything Plan E shipped: `react-router-dom`, `writeConfig`, `RegistrySchema` + `PersonSchema` + `ProjectSchema` (already in `src/config/schema.ts`), `ApiErrorBody` shape, atomic-write + cross-process file lock.

Plan E's E+F-combined spec covered F at design level. This document trims F to what's actually still open after E shipped, and locks in the working-copy state machine + comment-loss UI copy that the user will see.

## What carries over from Plan E (no relitigation)

- 412 on missing config (uniformly on GET and PUT).
- 400 with `{ errors: [{ path: string[], message }] }` for zod failures. The frontend's `ApiCallError.message` already formats path-scoped issues into a readable string when no `message` is set; row-level rendering uses the structured `body.errors` directly.
- `writeConfig` is the single mutation path. Comments outside the mutated block are preserved by `yaml.Document.set`; **comments inside the registry block are deleted on save** (UI warns).
- CSRF + origin enforcement carry through global middleware; the new route inherits.

## Goal

A two-tab `/registry` page (People · Projects). Each tab shows a list of rows that expand to inline edit forms. Edits accumulate in a working copy. One **Save changes** button at the route's top-right commits the whole registry via PUT — no per-row PUTs. **Discard changes** reverts to the last server snapshot.

## Non-goals

- Import from contacts / autocomplete from Slack workspace (spec'd as out-of-v1 in v2)
- Drag-to-reorder
- Full comment preservation inside the registry block
- Per-row PUTs / optimistic locking
- Schema migrations (registry shape is locked at this version)

## Architecture

### Routing

`web/src/App.tsx` already wraps in `<BrowserRouter>` with `<Routes>`. Add one entry:

```tsx
<Route path="/registry" element={<Registry />} />
```

`LibrarySidebar`'s nav header gains a third `NavLink` ("Registry") next to "Search" and "MCPs."

### Server route

`src/server/routes/registry.ts`:

```
GET    /api/registry          → 200 { registry: Registry } | 412 config-required
PUT    /api/registry          body: { registry: Registry }
                                → 200 { registry } | 400 invalid-body | 412 config-required
```

Both verbs return 412 when `scry.config.yaml` is absent. PUT validates with `RegistrySchema`, then calls `writeConfig({ registry })`. On 200, returns the saved `registry` so the frontend can replace its working copy with the canonical post-save state.

Empty registry shape returned by GET when the config exists but has no `registry:` block:

```json
{ "registry": { "people": {}, "projects": {} } }
```

The route reuses the same `loadServers`-shaped helper as Plan E (sync `existsSync` + `parse` of the YAML). This pattern is acceptable for localhost-only personal-tool use — same trade-off as Plan E.

### Frontend state machine (`web/src/routes/Registry.tsx`)

Four pieces of state:

- `server: Registry | null` — last-saved snapshot from GET or PUT response. Used as the source of truth for "Discard."
- `working: Registry | null` — local editable copy. Mirrors `server` on initial load and after every successful save; diverges on edit.
- `dirty: Set<string>` — keys (path strings like `people:andre`, `projects:ea`) of rows that differ from `server`. Computed via deep-equal against the corresponding `server` slice.
- `saveErrors: ApiErrorIssue[] | null` — path-scoped errors from the most recent failed PUT. Cleared on successful save or local edit.

URL state: `?tab=people` or `?tab=projects` via `useSearchParams`. Default `people`. Refresh keeps the active tab.

**Edit flow:**
1. User expands a row → inline form renders bound to `working[group][key]`.
2. User changes a field → `working` updates; `dirty` recomputes; row gets a yellow dot.
3. **Add Person / Add Project** → modal with `key` (slug) + `name` fields. On confirm, append to `working[group]` with the supplied key; row appears expanded and dirty.
4. **Delete row** → `window.confirm` → remove from `working[group]`; if the key was previously in `server`, mark its parent group dirty.
5. **Save changes** → PUT working. On 200, replace both `server` and `working` with the response; clear `dirty` and `saveErrors`. On 400, populate `saveErrors`; rows whose path matches an issue render an inline error.
6. **Discard changes** → `confirm("Discard N changes?")` → restore `working = server`; clear `dirty` and `saveErrors`.

### Components

| Component | Purpose |
|---|---|
| `web/src/routes/Registry.tsx` | Tabs + working-copy state machine + Save/Discard + saveErrors banner |
| `web/src/components/PersonRow.tsx` | Collapsed summary + expanded inline form (name, role, teams, aliases, identifiers, projects) |
| `web/src/components/ProjectRow.tsx` | Same shape (name, aliases, routing.slack_channels, routing.confluence_cql, routing.jira_project, people) |
| `web/src/components/AddRegistryEntryModal.tsx` | Slug-validated key input + name; used for both People and Projects |
| `web/src/components/ChipsInput.tsx` | Generic chip input (Enter / comma to add, Backspace on empty to remove last, click × to remove). Used for teams, aliases, projects, slack_channels, people |
| `web/src/lib/registry.ts` | Typed API client (`getRegistry`, `putRegistry`) |

`AddRegistryEntryModal` is one component shared by both tabs because the only difference is the parent `group` (`people` vs `projects`) and the key validation (same SLUG regex applies to both). Reuse beats two near-identical modals.

`ChipsInput` is also used by `McpAddModal`'s args field in a follow-up if we extract; keeping the abstraction inside `web/src/components/` for now.

### Per-row error rendering

When PUT returns 400 with `errors[]`, the frontend filters issues per row:

```ts
function errorsForRow(all: ApiErrorIssue[], group: 'people' | 'projects', key: string): ApiErrorIssue[] {
  return all.filter((i) => i.path[0] === group && i.path[1] === key);
}
```

Each row gets its `errors` prop. If non-empty, the row auto-expands and renders inline messages next to the offending field (matched by `path[2..]`). A summary banner above the tabs shows: "Validation failed — fix the highlighted fields below."

Issues whose path doesn't match any row (e.g., a top-level shape error) render only in the banner.

## Repo layout (additions)

```
src/server/routes/
└── registry.ts                NEW

web/src/routes/
└── Registry.tsx               NEW

web/src/components/
├── PersonRow.tsx              NEW
├── ProjectRow.tsx             NEW
├── ChipsInput.tsx             NEW
└── AddRegistryEntryModal.tsx  NEW

web/src/lib/
└── registry.ts                NEW
```

`src/server/index.ts` modified to mount `/api/registry`. `web/src/App.tsx` modified to add the `/registry` route. `web/src/components/LibrarySidebar.tsx` modified to add the third nav link.

No new dependencies. `react-router-dom`, `proper-lockfile`, zod, yaml all already installed via Plan E.

## Validation rules

Already locked into `src/config/schema.ts` (Plan E):

- Person: `name` non-empty; `role`, `teams`, `aliases`, `projects` optional; `identifiers` with optional `slack_username`, `email` (validated as email), `confluence_username`.
- Project: `name` non-empty; `aliases` optional; `routing` with optional `slack_channels`, `confluence_cql`, `jira_project`; `people` optional.
- Registry: `{ people: Record<SLUG, Person>, projects: Record<SLUG, Project> }`. Keys must match `^[a-z][a-z0-9_-]{0,63}$`.

The frontend re-uses these schemas via `web/src/lib/registry-validation.ts` (a re-export shim already pattern from Plan E for client-side mirroring) for inline shape checking on the AddEntry modal's slug field. Server validation is the source of truth; client validation is UX sugar.

## Concurrency

Inherits Plan E's model:
- Two browser tabs of `/registry` save simultaneously → `proper-lockfile` serializes; second write reads the post-first-write state inside the lock; **last write wins**.
- `scry serve` running while user `vim`s `scry.config.yaml` → not coordinated; documented as a non-goal.

## YAML comment policy (locked, with explicit UI copy)

Above the **Save changes** button: `Comments inside the registry block will be deleted on save. Edit scry.config.yaml directly if you want them preserved.`

This is honest. v2 spec section initially said "may be reformatted" — the GPT review flagged that as an understatement of "deleted." Plan E adopted the corrected language; F surfaces it in user-visible copy.

## Testing

| Layer | What's covered |
|---|---|
| `src/server/routes/registry.test.ts` | GET happy + 412; PUT happy + 400 with path-scoped errors; 412 on PUT when no config; CSRF rejection on PUT (defensive); golden test that comments OUTSIDE the registry block survive a PUT |
| `web/src/lib/registry.test.ts` | `getRegistry` + `putRegistry` typed client; 412 maps to `ApiCallError` with `status === 412`; 400 maps to `ApiCallError` with `body.errors` populated |
| `web/src/components/ChipsInput.test.tsx` | Add via Enter / comma; remove via Backspace on empty; click × |
| `web/src/components/AddRegistryEntryModal.test.tsx` | Slug-validated key field rejects malformed input; name required; submit dispatches with the typed group |
| `web/src/routes/Registry.test.tsx` | URL ↔ tab sync; expand row → edit field → dirty dot appears; Save fires PUT; **400 with path-scoped errors maps to row-level error rendering AND auto-expands the row**; Discard reverts; 412 shows onboarding stub empty state |

E2E (deferred to Plan I): edit a Project's `slack_channels` in the UI → next CLI search referencing that project produces a system prompt containing the routing.

## Risks

| Risk | Mitigation |
|---|---|
| Working-copy diverges on a slow PUT (user types during the network hop) | The edit flow is local-first; PUT carries a snapshot of `working` at click time; on 200, we replace `working` with the server response, blowing away any in-flight typing. Acceptable: the typing was concurrent with a save the user initiated; either we drop it (current) or we offer a "merge" UI (out of scope). Documented. |
| `addEntry` slug collides with an existing key | Modal validates against the current `working` state. If the user manages to add a duplicate via two simultaneous adds (impossible in a single tab), the server's PUT would still succeed because zod accepts overwrites; the second add wins. Single-user, single-tab assumption holds. |
| Identifiers' email validator rejects non-RFC values that nonetheless work in practice | Same zod `.email()` Plan E already uses for the schema. Edge cases (e.g. `+` aliases, internationalized) are accepted by `.email()`. If a user enters a hostile value like `not-an-email`, the inline error fires on Save with the path `["people", "<key>", "identifiers", "email"]`; the row auto-expands and the email field shows the message. |
| Comment loss surprises the user | Pre-Save UI copy is explicit. `.bak` from atomic write provides recovery. No silent data loss. |

## Acceptance criteria

- `/registry` is reachable from the sidebar nav (`Registry` link). Active tab indicator works.
- GET on a no-config machine returns 412; route shows the same onboarding-stub empty state as `/mcps`.
- People tab lists existing people; row collapsed by default; chevron toggles inline edit form.
- Editing a teams chip → row's dirty dot appears immediately; Discard reverts the chip.
- **Add Person** modal accepts `key` (slug) + `name`; rejects malformed keys with inline error; on confirm, row appears in the People list expanded and dirty.
- **Save changes** PUTs the working copy; on 200 the response replaces working+server and dirty clears; on 400 the response's `errors[]` maps to row-level errors and auto-expands those rows; the summary banner shows the count.
- Server-side: PUT happy path persists the registry to disk; comments above and below the `registry:` block survive byte-for-byte (golden test); editing inside the registry strips internal comments (documented).
- **CLI integration:** after editing a project's `slack_channels` and saving, the next `scry "<query>"` referencing that project produces a system prompt containing the new routing (E2E, deferred to Plan I).
- Two simultaneous PUTs from two browser tabs serialize; both succeed; second response reflects merged final state. (Same lock model as Plan E.)
- `npm test` passes (server + web). `npm pack --dry-run` shows only `dist/` and `README.md`.

## Decision log (deltas from Plan E only)

- **Single PUT, working-copy pattern.** Per-row PUTs would do N reads/N writes for a batched edit and add a partial-write failure mode. Atomic write means the whole registry is replaced anyway. The working-copy pattern matches Atom-of-Work / Discard semantics users expect from form-shaped editors.
- **Auto-expand rows with errors.** A user who hits 400 needs to find the offending field. Auto-expanding the row puts the inline error in their face, no scroll/hunt required.
- **`ChipsInput` is a shared component, not inlined.** Used in 5 places (teams, aliases, projects, slack_channels, and the modal's name preview). Extracting once is cheaper than five copies.
- **Add-entry modal is shared between tabs.** People and Projects differ only in the parent group; the modal accepts `group: 'people' | 'projects'` and dispatches accordingly. ~30 lines saved vs two near-identical files.
- **`registry-validation.ts` re-exports server schemas.** Plan E set up this shim pattern; F follows it. No drift between server and client validation; `import('@shared/...')` style alias resolution handled by the existing Vite + tsconfig path aliases (verified in Plan E's web build).

## Plan G handoff (filed during smoke)

Two outstanding items that Plan G must address (not blocking F):

1. **Env-allowlist union with `.scry.env`.** Spec acceptance criterion #3 from Plan E said "the union of (a) keys listed in this entry's env block AND (b) the explicit refs forwarded from `.scry.env` for the same MCP." Plan E implemented only (a). G's onboarding wizard auto-writes the `env:` block for each bundled MCP based on `bundled-servers.ts` metadata, which makes (a) sufficient for the bundled case. (b) remains an open design question for Plan G.
2. **`lastTestStatus` persistence.** Sidecar JSON at `~/.config/scry/mcp-test-status.json`. Out of F's scope; either tucked into a Plan E follow-up or rolled into G.

---

End of design.
