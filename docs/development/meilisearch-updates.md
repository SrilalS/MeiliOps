# New Meilisearch versions

MeiliOps targets the latest stable Meilisearch release. The API types are generated from the OpenAPI spec Meilisearch publishes with each release, so an update is mostly mechanical.

## Steps

1. Download the new release's `meilisearch-openapi.json` into `app/spec/`.
2. Regenerate the types, the API console's operation catalog and the version table (`src/api/since.json`):

```bash
npx openapi-typescript@7 spec/meilisearch-openapi.json -o src/api/schema.d.ts
```

```bash
npm run gen
```

3. Typecheck. Routes that were renamed or removed fail here, at every call site:

```bash
npm run typecheck
```

4. Check coverage. New stable operations without a screen fail here, and so do calls to new operations that aren't version-gated (see below):

```bash
npm run coverage -- --strict
```

5. Add screens for the new operations, gate them, and update the version mentioned in the docs.

The API console picks up every new operation automatically, so new routes are usable immediately, even before they get a dedicated screen.

## Older Meilisearch versions

MeiliOps supports **Meilisearch 1.18.0 and newer** (`MIN` in `app/scripts/gen-since.mjs`). 1.18 is the first release that publishes an OpenAPI spec, so what each version serves is measured rather than guessed.

- `npm run gen` runs `scripts/gen-since.mjs`, which downloads the spec of every minor release from 1.18 up (cached in `app/spec/history/`, gitignored) and writes `src/api/since.json`: each operation newer than 1.18 and the first version that serves it.
- Older specs sometimes left out routes that already worked. `PRESENT_AT_MIN` in the script lists the ones a live 1.18 server was probed to serve. Check a new entry against a real server before adding it.
- `src/lib/compat.ts` compares the connected server's version with that table: `supports(op)`, `needs(op)` (a tooltip for disabled controls) and `settingMissing(slug)`. Wrap a whole screen in `<Requires op=… feature=…>` (`components/Requires.tsx`).
- Older than 1.18: a banner says some screens may not work. Local instances only offer 1.18 and newer.

### Gating a new operation

Every call to an operation in `since.json` must be gated **in the same file**: a `supports`/`missing`/`needs` call or an `op` prop naming that operation, or one at least as new (a whole-screen `<Requires>` covers the screen's other calls). Settings sub-routes are gated by the Settings tab through `settingMissing`. `coverage --strict` fails on an ungated call, and when `since.json` was generated for a different spec version.

Prefer a fallback to hiding a feature when the data exists another way. For example, field capabilities come from `POST /fields` on 1.36+ and are worked out from the settings before that (`lib/fieldCaps.ts`).

## Coverage script details

`app/scripts/coverage.mjs` finds calls by scanning the source for the literal `"METHOD", "/path"` pattern, plus the settings catalog in `views/index/settingsCatalog.ts`. It knows that some routes are equivalent (for example the `GET` and `POST` forms of search) and that the `/network` routes are Enterprise-only.
