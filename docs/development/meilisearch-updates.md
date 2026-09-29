# New Meilisearch versions

MeiliOps targets the latest stable Meilisearch release. The API types are generated from the OpenAPI spec Meilisearch publishes with each release, so an update is mostly mechanical.

## Steps

1. Download the new release's `meilisearch-openapi.json` into `app/spec/`.
2. Regenerate the types and the API console's operation catalog:

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

4. Check coverage. New stable operations without a screen fail here:

```bash
npm run coverage -- --strict
```

5. Add screens for the new operations, and update the version mentioned in the docs.

The API console picks up every new operation automatically, so new routes are usable immediately, even before they get a dedicated screen.

## Coverage script details

`app/scripts/coverage.mjs` finds calls by scanning the source for the literal `"METHOD", "/path"` pattern, plus the settings catalog in `views/index/settingsCatalog.ts`. It knows that some routes are equivalent (for example the `GET` and `POST` forms of search) and that the `/network` routes are Enterprise-only.
