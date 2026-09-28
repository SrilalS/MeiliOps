// Catalog of every index-settings sub-route. Each entry covers three API
// operations: GET <route>, <method> <route>, DELETE <route>.
// scripts/coverage.mjs reads this table, so keep the `setting(...)` call shape.

export interface SettingDef {
  key: string;
  slug: string;
  method: "PUT" | "PATCH";
  group: string;
  label: string;
  help: string;
  reindex?: boolean;
  experimental?: boolean;
}

const setting = (key: string, method: "PUT" | "PATCH", slug: string, group: string, help: string, extra: Partial<SettingDef> = {}): SettingDef => ({
  key,
  slug,
  method,
  group,
  label: key,
  help,
  ...extra,
});

export const SETTINGS: SettingDef[] = [
  setting("searchableAttributes", "PUT", "searchable-attributes", "Attributes", "Fields searched, in order of importance.", { reindex: true }),
  setting("displayedAttributes", "PUT", "displayed-attributes", "Attributes", "Fields returned in documents and hits."),
  setting("filterableAttributes", "PUT", "filterable-attributes", "Attributes", "Fields usable in filters and facets (granular features per pattern).", { reindex: true }),
  setting("sortableAttributes", "PUT", "sortable-attributes", "Attributes", "Fields usable with `sort`.", { reindex: true }),
  setting("distinctAttribute", "PUT", "distinct-attribute", "Attributes", "Deduplicate hits on this field."),
  setting("localizedAttributes", "PUT", "localized-attributes", "Attributes", "Per-field locale hints for tokenization.", { reindex: true }),
  setting("foreignKeys", "PUT", "foreign-keys", "Attributes", "Cross-index relations used for document hydration.", { experimental: true }),

  setting("rankingRules", "PUT", "ranking-rules", "Relevancy", "Ordered ranking rules (words, typo, proximity, attribute, sort, exactness, …)."),
  setting("typoTolerance", "PATCH", "typo-tolerance", "Relevancy", "Typo thresholds, disabled words/attributes, numbers."),
  setting("synonyms", "PUT", "synonyms", "Relevancy", "Map of word → synonyms."),
  setting("stopWords", "PUT", "stop-words", "Relevancy", "Words ignored at search time.", { reindex: true }),
  setting("proximityPrecision", "PUT", "proximity-precision", "Relevancy", "byWord or byAttribute.", { reindex: true }),
  setting("searchCutoffMs", "PUT", "search-cutoff-ms", "Relevancy", "Max search time budget in ms."),

  setting("dictionary", "PUT", "dictionary", "Tokenization", "Custom words treated as single tokens.", { reindex: true }),
  setting("separatorTokens", "PUT", "separator-tokens", "Tokenization", "Extra word separators.", { reindex: true }),
  setting("nonSeparatorTokens", "PUT", "non-separator-tokens", "Tokenization", "Characters that are NOT separators.", { reindex: true }),

  setting("faceting", "PATCH", "faceting", "Facets & pagination", "maxValuesPerFacet, sortFacetValuesBy."),
  setting("facetSearch", "PUT", "facet-search", "Facets & pagination", "Enable/disable facet search.", { reindex: true }),
  setting("prefixSearch", "PUT", "prefix-search", "Facets & pagination", "indexingTime or disabled.", { reindex: true }),
  setting("pagination", "PATCH", "pagination", "Facets & pagination", "maxTotalHits."),

  setting("embedders", "PATCH", "embedders", "AI", "Embedders for vector/hybrid search (openAi, huggingFace, ollama, rest, userProvided, composite).", { reindex: true }),
  setting("chat", "PATCH", "chat", "AI", "Conversational search settings for this index."),
];
