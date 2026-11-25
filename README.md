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

Use `--oai-base-url` to harvest from another CollectiveAccess OAI endpoint:

```bash
bun run generate --oai-base-url https://example.org/service.php/OAI/ --no-delete
```

Supply the base URL before `schema_org/request` or `col_schema_org/request`. Both harvests and the OAI links in the CSV use that base. When testing a different export, `--no-delete` protects existing objects from being removed based on that export.

## Caching

The generator caches each raw OAI XML response under `.cache/collective-access/xml` using the complete request URL as its cache key. After a complete harvest, it also writes the parsed records to `.cache/collective-access/objects.json` and `.cache/collective-access/collections.json` for troubleshooting. These readable JSON snapshots are always regenerated from the XML harvest and are never used as cache inputs. DLCS image information remains cached under `.cache/dlcs`.

Alternate endpoints have separate snapshots under `.cache/collective-access/sources/<base-url-hash>/`.

You can bypass either cache independently, or both together:

```bash
# Refresh CollectiveAccess exports while reusing DLCS image information
bun run generate --no-collective-access-cache

# Refresh DLCS image information while reusing CollectiveAccess exports
bun run generate --no-dlcs-cache

# Refresh both
bun run generate --no-cache
```

Fresh successful responses update the corresponding cache and JSON snapshots. Cache files are ignored by Git. Because a cached harvest may be older than the checked-out generated data, cached XML is never used to decide which objects to delete; use `--no-collective-access-cache` (or `--no-cache`) for a fresh reconciliation.

## Safe updates

Generation updates files in place; it does not clear `build` first. Deletion is enabled by default: after a complete, fresh OAI harvest, objects absent from the public export are removed from `build/iiif/objects`, including both their manifest (`<uuid>.json`) and generated data directory (`<uuid>/`). Each removal is recorded in the CSV with the consequence `Object manifest and generated data deleted`. The previous JSON snapshot supplies source identifiers for deletion logs when available; otherwise, the generated schema supplies the name and inventory identifier, and missing source links are marked `unavailable`.

Use `--no-delete` to retain objects that are no longer exported:

```bash
bun run generate --no-collective-access-cache --no-delete
```

Deletion is also skipped when the harvest used cached XML or any active record cannot be mapped to a UUID. Invalid OAI responses fail the harvest instead of being treated as an empty export.

A record that fails schema validation, image lookup, or manifest generation is logged and its previously generated files are left unchanged. Existing schema data is also loaded before collection generation so a temporarily invalid object can remain in its collection.

Both the public collection and object inventories are fetched before any files are generated. Each generated object `schema.json` has a Schema.org `isPartOf` reference for every public collection that lists the object in `hasPart`; object manifests do not contain `partOf`. Unpublished or invalid collections are not referenced. Collections are written afterward and retain the availability check, so failed or missing object manifests are not included as collection items.

Valid collections are written even when they have no items. Each gets an IIIF Collection and a Schema.org export at `build/iiif/collections/<uuid>/schema.json`. A collection's `isPartOf` links add it as a child item of each available parent collection, alongside any object manifests from the parent's `hasPart`. The IIIF export uses `abstract` for its summary and `description` for **Description / Beschrijving** metadata, splitting both into arrays by line. Collection images supply thumbnails using their exported thumbnail URLs.

Each run writes a CSV log to `logs/`, with all object rows first and collection rows afterward. Every record-level row has a `type` of `object` or `collection` and includes the UUID derived from `@id`, the record name, a complete OAI `GetRecord` URL, and a direct link to the object or collection in CollectiveAccess. Object rows also include the human-facing metadata identifier; the identifier column is empty for collection rows. The `consequence` column describes the actual outcome, such as an existing manifest being used as fallback, no manifest being generated, or a manifest being generated without a failed image. When a failed object cannot be included in one or more collections, its object row combines both outcomes as `No manifest generated; Object omitted from collection`; the corresponding per-member collection error is not logged again. The CollectiveAccess link is built from the numeric suffix of the OAI identifier and the corresponding base URL in `src/settings.ts`. If malformed source data does not provide a required value, the log uses `unavailable` explicitly. Failed-image rows also include the image UUID, its complete source thumbnail URL, and a direct DLCS portal URL.

## GitHub Actions logs

The scheduled build fetches fresh CollectiveAccess exports and reuses the DLCS cache, so unpublished objects can be deleted on every successful harvest. Each run uploads `logs/*.csv` as a `generation-log-<run-id>-<attempt>` artifact, available from the workflow run's **Artifacts** section for 30 days. Upload is attempted even if generation fails. Logs remain ignored by Git, and the workflow commits only `build/iiif` changes, including deletions.

Run the checks with:

```bash
bun run test
bun run typecheck
```
