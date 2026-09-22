# CollectiveAccess to IIIF

This repository contains a command-line tool that creates [IIIF Presentation Manifests](https://iiif.io/api/presentation/3.0/) for records and collections in [CollectiveAccess](https://www.collectiveaccess.org/).

## Development

Install [Bun](https://bun.sh/docs/installation) javascript runtime (>= 1.2.2).

To install dependencies:

```bash
bun install
```

Generate the IIIF resources:

```bash
bun run generate
```

Show all CLI commands and options:

```bash
bun run index.ts --help
bun run index.ts generate --help
```

## Caching

The generator caches each raw OAI XML response under `.cache/collective-access/xml` using the complete request URL as its cache key. DLCS image information remains cached under `.cache/dlcs`.

Use `--no-cache` when the source has changed and a fresh response is required:

```bash
bun run generate --no-cache
```

Fresh successful responses replace their cached XML. Cache files are ignored by Git. Because a cached harvest may be older than the checked-out generated data, cached XML is never used to decide which objects to delete; use `--no-cache` for a fresh reconciliation.

## Safe updates

Generation updates files in place; it does not clear `build` first. An existing object manifest and its schema are removed only when a complete OAI response confirms that its UUID is no longer public. If an active source record cannot be mapped to a UUID, pruning is skipped for the entire run.

A record that fails schema validation, image lookup, or manifest generation is logged and its previously generated files are left unchanged. Existing schema data is also loaded before collection generation so a temporarily invalid object can remain in its collection.

Both the public collection and object inventories are fetched before any files are generated. Each generated object `schema.json` has a Schema.org `isPartOf` reference for every public collection that lists the object in `hasPart`; object manifests do not contain `partOf`. Unpublished or invalid collections are not referenced. Collections are written afterward and retain the availability check, so failed or missing object manifests are not included as collection items.

Each run writes a CSV log to `logs/`, with all object rows first and collection rows afterward. Every record-level row has a `type` of `object` or `collection` and includes the UUID derived from `@id`, the record name, a complete OAI `GetRecord` URL, and a direct link to the object or collection in CollectiveAccess. Object rows also include the human-facing metadata identifier; the identifier column is empty for collection rows. The `consequence` column describes the actual outcome, such as an existing manifest being used as fallback, no manifest being generated, or a manifest being generated without a failed image. When a failed object cannot be included in one or more collections, its object row combines both outcomes as `No manifest generated; Object omitted from collection`; the corresponding per-member collection error is not logged again. The CollectiveAccess link is built from the numeric suffix of the OAI identifier and the corresponding base URL in `src/settings.ts`. If malformed source data does not provide a required value, the log uses `unavailable` explicitly. Failed-image rows also include the image UUID, its complete source thumbnail URL, and a direct DLCS portal URL.

Run the checks with:

```bash
bun run test
bun run typecheck
```
