import fs from "node:fs/promises";
import { join } from "node:path";
import cliProgress from "cli-progress";
import * as z from "zod";
import {
  fetchImageInformationWithCache,
  fetchRecords,
  saveJson,
  type FetchedRecords,
} from "./fetches";
import { createCollection, createManifest } from "./iiif";
import {
  getOaiUrl,
  getUuid,
  getValueAsArray,
  writeCsvLog,
} from "./helpers.ts";
import {
  collectionsFolder,
  collectiveAccessCollectionBaseUrl,
  collectiveAccessObjectBaseUrl,
  dlcsPortalUrl as dlcsPortalBaseUrl,
  manifestUriBase,
  objectsFolder,
  outputDir,
} from "./settings";
import { SchemaCollectionMetadata, SchemaMetadata } from "./schema.ts";
import type {
  IIIFImageInformation,
  SchemaCollectionReference,
  SchemaRecord,
} from "./schema.ts";

export type GenerateOptions = {
  cache: boolean;
};

export type PublicObjectInventory = {
  complete: boolean;
  unmappedIdentifiers: string[];
  uuids: Set<string>;
};

type LogWriter = RecordLogEntry[];

export type PublicCollection = {
  metadata: SchemaCollectionMetadata;
  oaiIdentifier: string;
  uuid: string;
};

export type RecordLogContext = {
  collectiveAccessUrl: string;
  identifier: string;
  name: string;
  oaiUrl: string;
  type: "object" | "collection";
  uuid: string;
};

export type RecordLogEntry = RecordLogContext & {
  consequence: string;
  details: string;
  dlcsPortalUrl: string;
  imageUuid: string;
  message: string;
  thumbnailUrl: string;
};

export const recordLogColumns: (keyof RecordLogEntry)[] = [
  "type",
  "message",
  "consequence",
  "uuid",
  "name",
  "identifier",
  "oaiUrl",
  "collectiveAccessUrl",
  "details",
  "imageUuid",
  "thumbnailUrl",
  "dlcsPortalUrl",
];

export function sortRecordLogEntries(entries: readonly RecordLogEntry[]) {
  return [...entries].sort(
    (first, second) =>
      Number(first.type === "collection") -
      Number(second.type === "collection"),
  );
}

const unavailable = "unavailable";

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export function formatZodErrorDetails(error: z.ZodError) {
  return `Error: ${z.prettifyError(error).replace(/\s*\n\s*/g, " ")}`;
}

function validUuid(value: string | undefined): value is string {
  return z.uuid().safeParse(value).success;
}

function readableValue(value: unknown) {
  return typeof value === "string" && value.length ? value : unavailable;
}

function getCollectiveAccessUrl(
  oaiIdentifier: string | undefined,
  type: "objects" | "collections",
) {
  const recordId = oaiIdentifier?.match(/:(\d+)$/)?.[1];
  if (!recordId) return unavailable;

  const baseUrl =
    type === "objects"
      ? collectiveAccessObjectBaseUrl
      : collectiveAccessCollectionBaseUrl;
  return `${baseUrl}${recordId}`;
}

function createRecordLogContext(
  uuid: string | undefined,
  name: unknown,
  identifier: unknown,
  oaiIdentifier: string | undefined,
  type: "objects" | "collections",
): RecordLogContext {
  return {
    type: type === "objects" ? "object" : "collection",
    uuid: readableValue(uuid),
    name: readableValue(name),
    identifier: type === "objects" ? readableValue(identifier) : "",
    oaiUrl: oaiIdentifier ? getOaiUrl(oaiIdentifier, type) : unavailable,
    collectiveAccessUrl: getCollectiveAccessUrl(oaiIdentifier, type),
  };
}

export function getRecordLogContext(
  value: unknown,
  type: "objects" | "collections",
): RecordLogContext {
  const record = value as Partial<SchemaRecord<"object" | "collection">>;
  const metadata = record.metadata?.RDF?.CreativeWork as
    | Record<string, unknown>
    | undefined;
  const id = metadata?.["@id"];
  const uuid = typeof id === "string" ? getUuid(id) : undefined;
  return createRecordLogContext(
    uuid,
    metadata?.name,
    metadata?.identifier,
    record.header?.identifier,
    type,
  );
}

export function formatRecordLog(
  message: string,
  consequence: string,
  context: RecordLogContext,
  details = "",
  image: Partial<
    Pick<RecordLogEntry, "dlcsPortalUrl" | "imageUuid" | "thumbnailUrl">
  > = {},
): RecordLogEntry {
  return {
    ...context,
    message,
    consequence,
    details,
    imageUuid: image.imageUuid ?? "",
    thumbnailUrl: image.thumbnailUrl ?? "",
    dlcsPortalUrl: image.dlcsPortalUrl ?? "",
  };
}

export function getImageLogFields(imageUuid: string, thumbnailUrl: string) {
  return {
    imageUuid,
    thumbnailUrl,
    dlcsPortalUrl: `${dlcsPortalBaseUrl}${imageUuid}`,
  };
}

export function getObjectFailureConsequence(
  context: RecordLogContext,
  existingManifestUuids: ReadonlySet<string>,
  manifestsOnDisk: ReadonlyMap<string, SchemaMetadata>,
  isCollectionMember: boolean,
) {
  if (!validUuid(context.uuid)) return "No manifest generated";
  if (
    existingManifestUuids.has(context.uuid) &&
    manifestsOnDisk.has(context.uuid)
  ) {
    return "Existing manifest used as fallback";
  }
  if (manifestsOnDisk.has(context.uuid)) {
    return "Manifest generated earlier in this run retained";
  }
  if (existingManifestUuids.has(context.uuid)) {
    return isCollectionMember
      ? "Existing manifest retained; Object omitted from collection"
      : "Existing manifest retained";
  }
  return isCollectionMember
    ? "No manifest generated; Object omitted from collection"
    : "No manifest generated";
}

export function getLoggedCollectionOmissionUuids(writer: LogWriter) {
  return new Set(
    writer
      .filter(
        (entry) =>
          entry.type === "object" &&
          entry.consequence.includes("Object omitted from collection") &&
          validUuid(entry.uuid),
      )
      .map((entry) => entry.uuid),
  );
}

function getCollectionFailureConsequence(
  context: RecordLogContext,
  existingCollectionUuids: ReadonlySet<string>,
) {
  return validUuid(context.uuid) && existingCollectionUuids.has(context.uuid)
    ? "Existing collection used as fallback"
    : "No collection generated";
}

type FailedImageLog = {
  error: string;
  imageUuid: string;
  thumbnailUrl: string;
};

function writeFailedImageLogs(
  writer: LogWriter,
  context: RecordLogContext,
  failures: readonly FailedImageLog[],
  consequence: string,
) {
  for (const failure of failures) {
    writeRecordLog(
      writer,
      "Image information not found for object",
      consequence,
      context,
      `Error: ${failure.error}`,
      getImageLogFields(failure.imageUuid, failure.thumbnailUrl),
    );
  }
}

function writeRecordLog(
  writer: LogWriter,
  message: string,
  consequence: string,
  context: RecordLogContext,
  details?: string,
  image?: Partial<
    Pick<RecordLogEntry, "dlcsPortalUrl" | "imageUuid" | "thumbnailUrl">
  >,
) {
  writer.push(formatRecordLog(message, consequence, context, details, image));
}

function getObjectLogContexts(records: readonly unknown[]) {
  const contexts = new Map<string, RecordLogContext>();
  for (const record of records) {
    const context = getRecordLogContext(record, "objects");
    if (context.uuid !== unavailable) contexts.set(context.uuid, context);
  }
  return contexts;
}

export function getPublicObjectInventory(
  records: readonly unknown[],
): PublicObjectInventory {
  const inventory: PublicObjectInventory = {
    complete: true,
    unmappedIdentifiers: [],
    uuids: new Set(),
  };

  for (const value of records) {
    const record = value as Partial<SchemaRecord<"object">> & {
      header?: { identifier?: string; status?: string };
    };
    if (record.header?.status === "deleted") continue;

    const identifier = record.header?.identifier ?? "unknown record";
    const id = record.metadata?.RDF?.CreativeWork?.["@id"];
    const uuid = typeof id === "string" ? getUuid(id) : undefined;
    if (validUuid(uuid)) {
      inventory.uuids.add(uuid);
    } else {
      inventory.complete = false;
      inventory.unmappedIdentifiers.push(identifier);
    }
  }

  return inventory;
}

export function getCollectionMembership(
  collections: readonly PublicCollection[],
) {
  const membership = new Map<string, SchemaCollectionReference[]>();

  for (const collection of collections) {
    const reference: SchemaCollectionReference = {
      "@id": `${manifestUriBase}${collectionsFolder}/${collection.uuid}.json`,
      "@type": "Collection",
    };
    for (const entity of getValueAsArray(collection.metadata.hasPart)) {
      if (!entity.sameAs) continue;
      const objectUuid = getUuid(entity.sameAs);
      if (!validUuid(objectUuid)) continue;

      const references = membership.get(objectUuid) ?? [];
      if (!references.some(({ "@id": id }) => id === reference["@id"])) {
        references.push(reference);
        membership.set(objectUuid, references);
      }
    }
  }

  return membership;
}

export function withCollectionMembership(
  metadata: SchemaMetadata,
  collections: SchemaCollectionReference[] = [],
): SchemaMetadata {
  const { isPartOf: _existingMembership, ...objectMetadata } = metadata;
  if (!collections.length) return objectMetadata as SchemaMetadata;
  return { ...objectMetadata, isPartOf: collections } as SchemaMetadata;
}

async function listGeneratedObjectUuids(directory: string) {
  const objectsPath = join(directory, objectsFolder);
  let entries: Awaited<ReturnType<typeof fs.readdir>>;
  try {
    entries = await fs.readdir(objectsPath, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return new Set<string>();
    throw error;
  }

  const uuids = new Set<string>();
  for (const entry of entries) {
    const candidate = entry.isDirectory()
      ? entry.name
      : entry.isFile() && entry.name.endsWith(".json")
        ? entry.name.slice(0, -5)
        : undefined;
    if (validUuid(candidate)) uuids.add(candidate);
  }
  return uuids;
}

async function listGeneratedObjectManifestUuids(directory: string) {
  const objectsPath = join(directory, objectsFolder);
  let entries: Awaited<ReturnType<typeof fs.readdir>>;
  try {
    entries = await fs.readdir(objectsPath, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return new Set<string>();
    throw error;
  }

  const uuids = new Set<string>();
  for (const entry of entries) {
    const candidate =
      entry.isFile() && entry.name.endsWith(".json")
        ? entry.name.slice(0, -5)
        : undefined;
    if (validUuid(candidate)) uuids.add(candidate);
  }
  return uuids;
}

async function listGeneratedCollectionUuids(directory: string) {
  const collectionsPath = join(directory, collectionsFolder);
  let entries: Awaited<ReturnType<typeof fs.readdir>>;
  try {
    entries = await fs.readdir(collectionsPath, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return new Set<string>();
    throw error;
  }

  const uuids = new Set<string>();
  for (const entry of entries) {
    const candidate =
      entry.isFile() && entry.name.endsWith(".json")
        ? entry.name.slice(0, -5)
        : undefined;
    if (validUuid(candidate)) uuids.add(candidate);
  }
  return uuids;
}

export async function pruneUnavailableObjects(
  inventory: PublicObjectInventory,
  directory: string = outputDir,
) {
  if (!inventory.complete) return [];

  const generatedUuids = await listGeneratedObjectUuids(directory);
  const removed: string[] = [];
  for (const uuid of generatedUuids) {
    if (inventory.uuids.has(uuid)) continue;

    await Promise.all([
      fs.rm(join(directory, objectsFolder, `${uuid}.json`), { force: true }),
      fs.rm(join(directory, objectsFolder, uuid), {
        force: true,
        recursive: true,
      }),
    ]);
    removed.push(uuid);
  }
  return removed.sort();
}

async function loadGeneratedMetadata(
  writer: LogWriter,
  objectContexts: Map<string, RecordLogContext>,
  directory: string = outputDir,
) {
  const metadataByUuid = new Map<string, SchemaMetadata>();
  const uuids = await listGeneratedObjectUuids(directory);

  for (const uuid of uuids) {
    try {
      const json = await fs.readFile(
        join(directory, objectsFolder, uuid, "schema.json"),
        "utf8",
      );
      const metadata = JSON.parse(json) as Partial<SchemaMetadata>;
      if (
        typeof metadata["@id"] === "string" &&
        typeof metadata.name === "string"
      ) {
        metadataByUuid.set(uuid, metadata as SchemaMetadata);
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        writeRecordLog(
          writer,
          "Could not read existing generated metadata",
          "Existing manifest unavailable for collection fallback",
          objectContexts.get(uuid) ??
            createRecordLogContext(
              uuid,
              undefined,
              undefined,
              undefined,
              "objects",
            ),
          `Error: ${errorMessage(error)}`,
        );
      }
    }
  }

  return metadataByUuid;
}

async function generateObjects(
  objectResponse: FetchedRecords,
  useCache: boolean,
  writer: LogWriter,
  manifestsOnDisk: Map<string, SchemaMetadata>,
  existingManifestUuids: ReadonlySet<string>,
  collectionMembership: Map<string, SchemaCollectionReference[]>,
) {
  console.log("Generating IIIF Object Manifests...");
  const objects = objectResponse.records as SchemaRecord<"object">[];
  const inventory = getPublicObjectInventory(objects);
  const recordsWithoutImages = new Set<string>();
  const encounteredUuids = new Set<string>();
  let generated = 0;

  const bar = new cliProgress.Bar({}, cliProgress.Presets.shades_classic);
  bar.start(objects.length, 0);

  for (const [index, record] of objects.entries()) {
    let context = getRecordLogContext(record, "objects");
    let failedImages: FailedImageLog[] = [];
    const failureConsequence = () =>
      getObjectFailureConsequence(
        context,
        existingManifestUuids,
        manifestsOnDisk,
        collectionMembership.has(context.uuid),
      );
    try {
      if (record.header?.status === "deleted") continue;
      const metadata = record.metadata?.RDF?.CreativeWork;
      if (!metadata) {
        writeRecordLog(
          writer,
          "No metadata found for object",
          failureConsequence(),
          context,
        );
        continue;
      }

      const result = SchemaMetadata.safeParse(metadata);
      if (!result.success) {
        writeRecordLog(
          writer,
          "Parser failed for object",
          failureConsequence(),
          context,
          formatZodErrorDetails(result.error),
        );
        continue;
      }

      const parsedMetadata = result.data;
      const uuid = getUuid(parsedMetadata["@id"]);
      context = createRecordLogContext(
        uuid,
        parsedMetadata.name,
        parsedMetadata.identifier,
        record.header?.identifier,
        "objects",
      );
      if (!validUuid(uuid)) throw new Error(`Invalid object UUID in ${parsedMetadata["@id"]}`);

      if (encounteredUuids.has(uuid)) {
        writeRecordLog(
          writer,
          "Duplicate object record exported",
          "Duplicate record also processed",
          context,
        );
      }
      encounteredUuids.add(uuid);

      const images = getValueAsArray(parsedMetadata.image);
      if (!images.length) {
        writeRecordLog(
          writer,
          "No images found for object",
          failureConsequence(),
          context,
        );
        recordsWithoutImages.add(uuid);
        continue;
      }

      const imageResults = await Promise.all(
        images.map(async (image) => {
          const imageUuid = getUuid(image.contentUrl["@id"]);
          if (!validUuid(imageUuid)) {
            throw new Error(`Invalid image UUID in ${image.contentUrl["@id"]}`);
          }
          try {
            return {
              image,
              imageUuid,
              response: await fetchImageInformationWithCache(
                imageUuid,
                useCache,
              ),
            };
          } catch (error) {
            return {
              image,
              imageUuid,
              response: { error: errorMessage(error) },
            };
          }
        }),
      );
      const imageInformation: IIIFImageInformation[] = [];
      for (const { image, imageUuid, response } of imageResults) {
        if ("error" in response) {
          failedImages.push({
            error: response.error,
            imageUuid,
            thumbnailUrl: image.thumbnailUrl,
          });
        } else {
          imageInformation.push(response);
        }
      }

      if (!imageInformation.length) {
        writeFailedImageLogs(
          writer,
          context,
          failedImages,
          failureConsequence(),
        );
        failedImages = [];
        continue;
      }

      const metadataWithMembership = withCollectionMembership(
        parsedMetadata,
        collectionMembership.get(uuid),
      );
      const manifest = createManifest(
        imageInformation,
        metadataWithMembership,
        uuid,
      );
      await saveJson(manifest, uuid, join(outputDir, objectsFolder));
      await saveJson(
        metadataWithMembership,
        "schema",
        join(outputDir, objectsFolder, uuid),
      );
      manifestsOnDisk.set(uuid, metadataWithMembership);
      generated++;
      writeFailedImageLogs(
        writer,
        context,
        failedImages,
        "Manifest generated without this image",
      );
      failedImages = [];
    } catch (error) {
      const consequence = failureConsequence();
      writeFailedImageLogs(writer, context, failedImages, consequence);
      writeRecordLog(
        writer,
        "Generation failed for object",
        consequence,
        context,
        `Error: ${errorMessage(error)}`,
      );
    } finally {
      bar.update(index + 1);
    }
  }

  bar.stop();
  console.log(`${generated} manifests created or updated`);
  if (recordsWithoutImages.size) {
    console.log(`${recordsWithoutImages.size} public objects had no images`);
  }

  if (objectResponse.usedCachedResponse) {
    const message =
      "Object pruning skipped because the OAI harvest used cached XML";
    console.warn(message);
    return;
  }

  if (!inventory.complete) {
    const message = `Object pruning skipped because public UUIDs could not be determined for ${inventory.unmappedIdentifiers.length} active record(s)`;
    console.warn(message);
    for (const record of objects) {
      if (record.header?.status === "deleted") continue;
      const context = getRecordLogContext(record, "objects");
      if (!validUuid(context.uuid)) {
        writeRecordLog(
          writer,
          message,
          "No generated objects deleted",
          context,
        );
      }
    }
    return;
  }

  const removed = await pruneUnavailableObjects(inventory);
  for (const uuid of removed) manifestsOnDisk.delete(uuid);
  console.log(`${removed.length} unpublished objects removed`);
}

function parsePublicCollections(
  collectionResponse: FetchedRecords,
  writer: LogWriter,
  existingCollectionUuids: ReadonlySet<string>,
) {
  const collections = collectionResponse.records as SchemaRecord<"collection">[];
  const publicCollections: PublicCollection[] = [];

  for (const sourceCollection of collections) {
    const oaiIdentifier = sourceCollection.header?.identifier;
    let context = getRecordLogContext(sourceCollection, "collections");
    try {
      if (sourceCollection.header?.status === "deleted") continue;
      const result = SchemaCollectionMetadata.safeParse(
        sourceCollection.metadata?.RDF?.CreativeWork,
      );
      if (!result.success) {
        writeRecordLog(
          writer,
          "Parser failed for collection",
          getCollectionFailureConsequence(context, existingCollectionUuids),
          context,
          formatZodErrorDetails(result.error),
        );
        continue;
      }

      const uuid = getUuid(result.data["@id"]);
      context = createRecordLogContext(
        uuid,
        result.data.name,
        result.data.identifier,
        oaiIdentifier,
        "collections",
      );
      if (!validUuid(uuid)) {
        throw new Error(`Invalid collection UUID in ${result.data["@id"]}`);
      }
      publicCollections.push({
        metadata: result.data,
        oaiIdentifier: oaiIdentifier ?? unavailable,
        uuid,
      });
    } catch (error) {
      writeRecordLog(
        writer,
        "Loading failed for collection",
        getCollectionFailureConsequence(context, existingCollectionUuids),
        context,
        `Error: ${errorMessage(error)}`,
      );
    }
  }

  return publicCollections;
}

async function generateCollections(
  collections: readonly PublicCollection[],
  writer: LogWriter,
  manifestsOnDisk: Map<string, SchemaMetadata>,
  existingCollectionUuids: ReadonlySet<string>,
  loggedCollectionOmissionUuids: ReadonlySet<string>,
) {
  console.log("Generating IIIF Collection Manifests...");
  const recordsInCollections = new Set<string>();
  let generated = 0;

  for (const sourceCollection of collections) {
    const {
      metadata: parsedMetadata,
      oaiIdentifier,
      uuid,
    } = sourceCollection;
    const context = createRecordLogContext(
      uuid,
      parsedMetadata.name,
      parsedMetadata.identifier,
      oaiIdentifier === unavailable ? undefined : oaiIdentifier,
      "collections",
    );
    try {
      const records = getValueAsArray(parsedMetadata.hasPart)
        .map((entity) => {
          if (!entity.sameAs) return undefined;
          const objectUuid = getUuid(entity.sameAs);
          if (!validUuid(objectUuid)) {
            writeRecordLog(
              writer,
              "Invalid object reference in collection",
              "Object omitted from collection",
              context,
              `Object reference: ${entity.sameAs}`,
            );
            return undefined;
          }
          if (!manifestsOnDisk.has(objectUuid)) {
            if (!loggedCollectionOmissionUuids.has(objectUuid)) {
              writeRecordLog(
                writer,
                "Object manifest is not available for collection member",
                "Object omitted from collection",
                context,
                `Object UUID: ${objectUuid}`,
              );
            }
            return undefined;
          }
          recordsInCollections.add(objectUuid);
          return manifestsOnDisk.get(objectUuid);
        })
        .filter((record): record is SchemaMetadata => record !== undefined);

      if (!records.length) {
        writeRecordLog(
          writer,
          "No available object manifests found for collection",
          getCollectionFailureConsequence(context, existingCollectionUuids),
          context,
        );
        continue;
      }

      const collection = createCollection(records, parsedMetadata, uuid);
      await saveJson(collection, uuid, join(outputDir, collectionsFolder));
      generated++;
    } catch (error) {
      writeRecordLog(
        writer,
        "Generation failed for collection",
        getCollectionFailureConsequence(context, existingCollectionUuids),
        context,
        `Error: ${errorMessage(error)}`,
      );
    }
  }

  console.log(`${generated} collections created or updated`);
  console.log(
    `${recordsInCollections.size} records have been added to collections`,
  );
}

export async function runGenerate(options: GenerateOptions) {
  const writer: LogWriter = [];

  try {
    console.log("Fetching public collection and object inventories...");
    const collectionResponse = await fetchRecords("collections", {
      useCache: options.cache,
    });
    const objectResponse = await fetchRecords("objects", {
      useCache: options.cache,
    });
    const objectContexts = getObjectLogContexts(objectResponse.records);
    const existingManifestUuids = await listGeneratedObjectManifestUuids(
      outputDir,
    );
    const existingCollectionUuids = await listGeneratedCollectionUuids(
      outputDir,
    );
    const manifestsOnDisk = await loadGeneratedMetadata(
      writer,
      objectContexts,
    );
    const publicCollections = parsePublicCollections(
      collectionResponse,
      writer,
      existingCollectionUuids,
    );
    const collectionMembership = getCollectionMembership(publicCollections);
    await generateObjects(
      objectResponse,
      options.cache,
      writer,
      manifestsOnDisk,
      existingManifestUuids,
      collectionMembership,
    );
    const loggedCollectionOmissionUuids =
      getLoggedCollectionOmissionUuids(writer);
    await generateCollections(
      publicCollections,
      writer,
      manifestsOnDisk,
      existingCollectionUuids,
      loggedCollectionOmissionUuids,
    );
  } finally {
    const logPath = await writeCsvLog(
      sortRecordLogEntries(writer),
      recordLogColumns,
    );
    console.log(`Written log: ./${logPath}`);
  }
}
