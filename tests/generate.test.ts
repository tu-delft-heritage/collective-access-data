import { afterEach, describe, expect, test } from "bun:test";
import fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { csv2json } from "json-2-csv";
import * as z from "zod";
import {
  formatRecordLog,
  formatZodErrorDetails,
  getCollectionMembership,
  getImageLogFields,
  getLoggedCollectionOmissionUuids,
  getObjectFailureConsequence,
  getPublicObjectInventory,
  getRecordLogContext,
  pruneUnavailableObjects,
  recordLogColumns,
  sortRecordLogEntries,
  withCollectionMembership,
  type PublicCollection,
} from "../src/generate.ts";
import { writeCsvLog } from "../src/helpers.ts";
import type { SchemaMetadata } from "../src/schema.ts";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      fs.rm(directory, { force: true, recursive: true }),
    ),
  );
});

async function createGeneratedObject(directory: string, uuid: string) {
  const objectDirectory = join(directory, "objects", uuid);
  await fs.mkdir(objectDirectory, { recursive: true });
  await Promise.all([
    fs.writeFile(join(directory, "objects", `${uuid}.json`), "{}"),
    fs.writeFile(join(objectDirectory, "schema.json"), "{}"),
  ]);
}

describe("public object reconciliation", () => {
  test("an invalid public record still protects its generated object", () => {
    const uuid = "11111111-1111-4111-8111-111111111111";
    const inventory = getPublicObjectInventory([
      {
        header: { identifier: "oai:test:1" },
        metadata: {
          RDF: {
            CreativeWork: {
              "@id": `https://heritage.tudelft.nl/iiif/manifests/${uuid}/schema.json`,
            },
          },
        },
      },
    ]);

    expect(inventory.complete).toBe(true);
    expect(inventory.uuids).toContain(uuid);
  });

  test("treats OAI deletion tombstones as unpublished objects", () => {
    const inventory = getPublicObjectInventory([
      {
        header: {
          identifier: "oai:test:deleted",
          status: "deleted",
        },
      },
    ]);

    expect(inventory.complete).toBe(true);
    expect(inventory.uuids.size).toBe(0);
  });

  test("removes only generated objects absent from a complete public inventory", async () => {
    const directory = await fs.mkdtemp(join(tmpdir(), "collective-access-data-"));
    temporaryDirectories.push(directory);
    const retained = "11111111-1111-4111-8111-111111111111";
    const removed = "22222222-2222-4222-8222-222222222222";
    await createGeneratedObject(directory, retained);
    await createGeneratedObject(directory, removed);

    const result = await pruneUnavailableObjects(
      { complete: true, unmappedIdentifiers: [], uuids: new Set([retained]) },
      directory,
    );

    expect(result).toEqual([removed]);
    expect(await Bun.file(join(directory, "objects", `${retained}.json`)).exists()).toBe(true);
    expect(await Bun.file(join(directory, "objects", `${removed}.json`)).exists()).toBe(false);
    expect(await Bun.file(join(directory, "objects", removed, "schema.json")).exists()).toBe(false);
  });

  test("skips all pruning when any active record cannot be mapped", async () => {
    const directory = await fs.mkdtemp(join(tmpdir(), "collective-access-data-"));
    temporaryDirectories.push(directory);
    const uuid = "22222222-2222-4222-8222-222222222222";
    await createGeneratedObject(directory, uuid);
    const inventory = getPublicObjectInventory([
      { header: { identifier: "oai:test:unmappable" }, metadata: {} },
    ]);

    const result = await pruneUnavailableObjects(inventory, directory);

    expect(inventory.complete).toBe(false);
    expect(result).toEqual([]);
    expect(await Bun.file(join(directory, "objects", `${uuid}.json`)).exists()).toBe(true);
  });
});

describe("collection membership", () => {
  test("maps an object to each public collection that contains it", () => {
    const objectUuid = "11111111-1111-4111-8111-111111111111";
    const collectionUuids = [
      "22222222-2222-4222-8222-222222222222",
      "33333333-3333-4333-8333-333333333333",
    ];
    const collections = collectionUuids.map(
      (uuid, index): PublicCollection => ({
        oaiIdentifier: `oai:test:collection:${index}`,
        uuid,
        metadata: {
          "@id": `https://heritage.tudelft.nl/iiif/collections/${uuid}/schema.json`,
          name: `Collection ${index}`,
          description: "Public collection",
          identifier: `collection-${index}`,
          hasPart: {
            "@type": "CreativeWork",
            name: "Object",
            sameAs: `https://heritage.tudelft.nl/iiif/manifests/${objectUuid}/schema.json`,
          },
        },
      }),
    );

    const membership = getCollectionMembership(collections);

    expect(membership.get(objectUuid)).toEqual(
      collectionUuids.map((uuid) => ({
        "@id": `https://tu-delft-heritage.github.io/collective-access-data/iiif/collections/${uuid}.json`,
        "@type": "Collection",
      })),
    );
  });

  test("adds collection membership to object schema metadata", () => {
    const metadata = {
      "@context": "https://schema.org",
      "@type": "CreativeWork",
      "@id": "https://heritage.tudelft.nl/iiif/manifests/11111111-1111-4111-8111-111111111111/schema.json",
      name: "Test object",
      identifier: "test-object",
      exampleOfWork: { "@type": "CreativeWork", name: "Object" },
      height: { "@type": "QuantitativeValue" },
      width: { "@type": "QuantitativeValue" },
      depth: { "@type": "QuantitativeValue" },
    } as SchemaMetadata;
    const references = [
      {
        "@id": "https://example.org/collections/public.json",
        "@type": "Collection" as const,
      },
    ];

    const result = withCollectionMembership(metadata, references);

    expect(result.isPartOf).toEqual(references);
  });
});

describe("record logging", () => {
  test("creates an object CSV row with all source identifiers and links", () => {
    const uuid = "11111111-1111-4111-8111-111111111111";
    const context = getRecordLogContext(
      {
        header: { identifier: "oai:oai.tudelft:11" },
        metadata: {
          RDF: {
            CreativeWork: {
              "@id": `https://heritage.tudelft.nl/iiif/manifests/${uuid}/schema.json`,
              name: "Ceramic test object",
              identifier: "2002.0052.CTG",
            },
          },
        },
      },
      "objects",
    );

    expect(
      formatRecordLog("Parser failed", "Existing manifest used as fallback", context),
    ).toEqual({
      type: "object",
      message: "Parser failed",
      consequence: "Existing manifest used as fallback",
      uuid,
      name: "Ceramic test object",
      identifier: "2002.0052.CTG",
      oaiUrl:
        "https://cms.collectiveaccess.tudelft.nl/service.php/OAI/schema_org/request?verb=GetRecord&identifier=oai%3Aoai.tudelft%3A11&metadataPrefix=rdf",
      collectiveAccessUrl:
        "https://collectiveaccess.tudelft.nl/ca_tudelft/admin/index.php/editor/objects/ObjectEditor/Edit/object_id/11",
      details: "",
      imageUuid: "",
      thumbnailUrl: "",
      dlcsPortalUrl: "",
    });
  });

  test("uses the collection name but leaves its identifier blank", () => {
    const context = getRecordLogContext(
      {
        header: { identifier: "oai:oai.tudelft:42" },
        metadata: {
          RDF: {
            CreativeWork: {
              name: "Architecture collection",
              identifier: "COL-42",
            },
          },
        },
      },
      "collections",
    );

    expect(context.collectiveAccessUrl).toBe(
      "https://collectiveaccess.tudelft.nl/ca_tudelft/admin/index.php/editor/collections/CollectionEditor/Edit/collection_id/42",
    );
    expect(context.type).toBe("collection");
    expect(context.name).toBe("Architecture collection");
    expect(context.identifier).toBe("");
  });

  test("uses explicit unavailable markers for malformed source records", () => {
    const context = getRecordLogContext(
      { header: { identifier: "oai:oai.tudelft:broken" } },
      "objects",
    );

    const row = formatRecordLog("No metadata", "No manifest generated", context);
    expect(row.uuid).toBe("unavailable");
    expect(row.name).toBe("unavailable");
    expect(row.identifier).toBe("unavailable");
    expect(row.oaiUrl).toBe(
      "https://cms.collectiveaccess.tudelft.nl/service.php/OAI/schema_org/request?verb=GetRecord&identifier=oai%3Aoai.tudelft%3Abroken&metadataPrefix=rdf",
    );
    expect(row.collectiveAccessUrl).toBe("unavailable");
  });

  test("includes source and DLCS links for failed images", () => {
    const imageUuid = "22222222-2222-4222-8222-222222222222";
    const thumbnailUrl =
      `https://dlc.services/thumbs/7/18/${imageUuid}/full/full/0/default.jpg`;

    expect(getImageLogFields(imageUuid, thumbnailUrl)).toEqual({
      imageUuid,
      thumbnailUrl,
      dlcsPortalUrl: `https://portal.dlc.services/Images/18/${imageUuid}`,
    });
  });

  test("combines a missing manifest with its collection omission", () => {
    const uuid = "33333333-3333-4333-8333-333333333333";
    const context = getRecordLogContext(
      {
        metadata: {
          RDF: {
            CreativeWork: {
              "@id": `https://heritage.tudelft.nl/iiif/manifests/${uuid}/schema.json`,
              name: "Missing object",
            },
          },
        },
      },
      "objects",
    );
    const consequence = getObjectFailureConsequence(
      context,
      new Set(),
      new Map(),
      true,
    );
    const entry = formatRecordLog("Parser failed", consequence, context);

    expect(consequence).toBe(
      "No manifest generated; Object omitted from collection",
    );
    expect(getLoggedCollectionOmissionUuids([entry])).toContain(uuid);
  });

  test("writes structured rows to a CSV file", async () => {
    const directory = await fs.mkdtemp(join(tmpdir(), "collective-access-log-"));
    temporaryDirectories.push(directory);
    const context = getRecordLogContext(
      {
        header: { identifier: "oai:oai.tudelft:42" },
        metadata: { RDF: { CreativeWork: { name: "Test collection" } } },
      },
      "collections",
    );
    const entry = formatRecordLog(
      "Parser failed for collection",
      "Existing collection used as fallback",
      context,
      "First line\nSecond line",
    );

    const path = await writeCsvLog([entry], recordLogColumns, directory);
    const csv = await fs.readFile(path, "utf8");
    const [row] = csv2json(csv) as Record<string, string>[];

    expect(path).toEndWith(".csv");
    expect(row.type).toBe("collection");
    expect(row.name).toBe("Test collection");
    expect(row.identifier).toBe("");
    expect(row.message).toBe("Parser failed for collection");
    expect(row.consequence).toBe("Existing collection used as fallback");
    expect(row.details).toBe("First line\nSecond line");
    expect(row.collectiveAccessUrl).toBe(
      "https://collectiveaccess.tudelft.nl/ca_tudelft/admin/index.php/editor/collections/CollectionEditor/Edit/collection_id/42",
    );
  });

  test("sorts object rows before collection rows", () => {
    const objectContext = getRecordLogContext({}, "objects");
    const collectionContext = getRecordLogContext({}, "collections");
    const entries = [
      formatRecordLog("Collection one", "No collection generated", collectionContext),
      formatRecordLog("Object one", "No manifest generated", objectContext),
      formatRecordLog("Collection two", "No collection generated", collectionContext),
      formatRecordLog("Object two", "No manifest generated", objectContext),
    ];

    expect(sortRecordLogEntries(entries).map(({ message }) => message)).toEqual([
      "Object one",
      "Object two",
      "Collection one",
      "Collection two",
    ]);
  });

  test("formats Zod parser errors without newlines", () => {
    const result = z.object({ name: z.string() }).safeParse({});
    if (result.success) throw new Error("Expected Zod parsing to fail");

    const details = formatZodErrorDetails(result.error);

    expect(details).toStartWith("Error: ");
    expect(details).not.toContain("\n");
    expect(details).toContain("name");
  });
});
