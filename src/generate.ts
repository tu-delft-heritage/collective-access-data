import fs from "node:fs/promises";
import { join } from "node:path";
import cliProgress from "cli-progress";
import * as z from "zod";
import {
  fetchImageInformationWithCache,
  fetchRecords,
  getRecordsSnapshotPath,
  saveJson,
  type FetchedRecords,
} from "./fetches";
import { createCollection, createManifest } from "./iiif";
import {
  getOaiUrl,
  getUuid,
  getValueAsArray,
  normalizeOaiBaseUrl,
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
  cache?: boolean;
  collectiveAccessCache?: boolean;
  dlcsCache?: boolean;
  delete?: boolean;
  oaiBaseUrl?: string;
};

export function resolveGenerateOptions(options: GenerateOptions = {}) {
  return {
    collectiveAccessCache:
      options.cache !== false && options.collectiveAccessCache !== false,
    dlcsCache: options.cache !== false && options.dlcsCache !== false,
    delete: options.delete !== false,
    oaiBaseUrl: normalizeOaiBaseUrl(options.oaiBaseUrl),
  };
}

type RecordType = typeof objectsFolder | typeof collectionsFolder;

type PublicInventory = {
  complete: boolean;
  unmappedIdentifiers: string[];
  uuids: Set<string>;
};

export type PublicObjectInventory = PublicInventory;

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
  type: RecordType,
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
  type: RecordType,
  oaiBaseUrl?: string,
): RecordLogContext {
  return {
    type: type === "objects" ? "object" : "collection",
    uuid: readableValue(uuid),
    name: readableValue(name),
    identifier: type === "objects" ? readableValue(identifier) : "",
    oaiUrl: oaiIdentifier
      ? getOaiUrl(oaiIdentifier, type, oaiBaseUrl)
      : unavailable,
    collectiveAccessUrl: getCollectiveAccessUrl(oaiIdentifier, type),
  };
}

export function getRecordLogContext(
  value: unknown,
  type: RecordType,
  oaiBaseUrl?: string,
): RecordLogContext {
  const record = value as Partial<SchemaRecord<"object" | "collection">> | undefined;
  const metadata = record?.metadata?.RDF?.CreativeWork as
    | Record<string, unknown>
    | undefined;
  const id = metadata?.["@id"];
  const uuid = typeof id === "string" ? getUuid(id) : undefined;
  return createRecordLogContext(
    uuid,
    metadata?.name,
    metadata?.identifier,
    record?.header?.identifier,
    type,
    oaiBaseUrl,
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

function getRecordLogContexts(
  records: readonly unknown[],
  type: RecordType,
  oaiBaseUrl: string,
) {
  const contexts = new Map<string, RecordLogContext>();
  for (const record of records) {
    const context = getRecordLogContext(record, type, oaiBaseUrl);
    if (context.uuid !== unavailable) contexts.set(context.uuid, context);
  }
  return contexts;
}

async function readPreviousLogContexts(type: RecordType, oaiBaseUrl: string) {
  try {
    const snapshot = await fs.readFile(
      getRecordsSnapshotPath(type, undefined, oaiBaseUrl),
      "utf8",
    );
    const records: unknown = JSON.parse(snapshot);
    if (!Array.isArray(records)) throw new Error("Expected an array of records");
    return getRecordLogContexts(records, type, oaiBaseUrl);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      console.warn(
        `Could not load previous log context for ${type}: ${errorMessage(error)}`,
      );
    }
    return new Map<string, RecordLogContext>();
  }
}

function getPublicInventory(records: readonly unknown[]): PublicInventory {
  const inventory: PublicInventory = {
    complete: true,
    unmappedIdentifiers: [],
    uuids: new Set(),
  };

  for (const value of records) {
    const record = value as Partial<SchemaRecord<"object" | "collection">> | undefined;
    if (record?.header?.status === "deleted") continue;

    const identifier = record?.header?.identifier ?? "unknown record";
    const id = record?.metadata?.RDF?.CreativeWork?.["@id"];
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

export { getPublicInventory as getPublicObjectInventory };

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

async function listGeneratedUuids(
  directory: string,
  type: RecordType,
  includeDataDirectories = false,
) {
  let entries: Awaited<ReturnType<typeof fs.readdir>>;
  try {
    entries = await fs.readdir(join(directory, type), { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return new Set<string>();
    throw error;
  }

  const uuids = new Set<string>();
  for (const entry of entries) {
    const candidate = includeDataDirectories && entry.isDirectory()
      ? entry.name
      : entry.isFile() && entry.name.endsWith(".json")
        ? entry.name.slice(0, -5)
        : undefined;
    if (validUuid(candidate)) uuids.add(candidate);
  }
  return uuids;
}

async function listUnavailableGeneratedUuids(
  directory: string,
  type: RecordType,
  inventory: PublicInventory,
) {
  if (!inventory.complete) return [];

  const generatedUuids = await listGeneratedUuids(directory, type, true);
  return [...generatedUuids].filter((uuid) => !inventory.uuids.has(uuid));
}

async function removeGeneratedRecord(resourcePath: string) {
  await Promise.all([
    fs.rm(`${resourcePath}.json`, { force: true }),
    fs.rm(resourcePath, { force: true, recursive: true }),
  ]);
}

export async function pruneUnavailableObjects(
  inventory: PublicObjectInventory,
  directory: string = outputDir,
  onRemoved?: (uuid: string) => void,
) {
  const removed = await listUnavailableGeneratedUuids(directory, objectsFolder, inventory);
  for (const uuid of removed) {
    await removeGeneratedRecord(join(directory, objectsFolder, uuid));
    onRemoved?.(uuid);
  }
  return removed.sort();
}

type ReconcileOptions = { delete?: boolean; directory?: string; oaiBaseUrl?: string };

async function readGeneratedSchema(resourcePath: string): Promise<unknown> {
  const json = await fs.readFile(join(resourcePath, "schema.json"), "utf8");
  return JSON.parse(json);
}

async function reconcileUnavailableRecords(
  type: RecordType,
  response: FetchedRecords,
  writer: LogWriter,
  contexts: ReadonlyMap<string, RecordLogContext>,
  options: ReconcileOptions,
  manifestsOnDisk?: Map<string, SchemaMetadata>,
) {
  const label = type === objectsFolder ? "Object" : "Collection";
  if (options.delete === false) {
    console.log(`${label} deletion disabled (--no-delete)`);
    return [];
  }
  if (response.usedCachedResponse) {
    console.warn(`${label} pruning skipped because the OAI harvest used cached XML`);
    return [];
  }

  const inventory = getPublicInventory(response.records);
  if (!inventory.complete) {
    const message = `${label} pruning skipped because public UUIDs could not be determined for ${inventory.unmappedIdentifiers.length} active record(s)`;
    console.warn(message);
    for (const record of response.records) {
      const source = record as { header?: { status?: string } } | undefined;
      if (source?.header?.status === "deleted") continue;
      const context = getRecordLogContext(record, type, options.oaiBaseUrl);
      if (!validUuid(context.uuid)) {
        writeRecordLog(writer, message, `No generated ${type} deleted`, context);
      }
    }
    return [];
  }

  const directory = options.directory ?? outputDir;
  const removed = await listUnavailableGeneratedUuids(directory, type, inventory);
  for (const uuid of removed) {
    const resourcePath = join(directory, type, uuid);
    let context = contexts.get(uuid);
    if (!context) {
      const metadata = (manifestsOnDisk
        ? manifestsOnDisk.get(uuid)
        : await readGeneratedSchema(resourcePath).catch(() => undefined)) as
        | { name?: unknown; identifier?: unknown }
        | undefined;
      context = createRecordLogContext(
        uuid,
        metadata?.name,
        metadata?.identifier,
        undefined,
        type,
      );
    }
    await removeGeneratedRecord(resourcePath);
    writeRecordLog(
      writer,
      `${label} no longer present in CollectiveAccess export`,
      `${label} manifest and generated data deleted`,
      context,
      `Deleted: ${resourcePath}.json and ${resourcePath}`,
    );
    manifestsOnDisk?.delete(uuid);
  }
  console.log(`${removed.length} unpublished ${type} removed`);
  return removed.sort();
}

export function reconcileUnavailableObjects(
  response: FetchedRecords,
  writer: LogWriter,
  manifestsOnDisk: Map<string, SchemaMetadata>,
  objectContexts: ReadonlyMap<string, RecordLogContext>,
  options: ReconcileOptions = {},
) {
  return reconcileUnavailableRecords(
    objectsFolder, response, writer, objectContexts, options, manifestsOnDisk,
  );
}

export function reconcileUnavailableCollections(
  response: FetchedRecords,
  writer: LogWriter,
  collectionContexts: ReadonlyMap<string, RecordLogContext>,
  options: ReconcileOptions = {},
) {
  return reconcileUnavailableRecords(collectionsFolder, response, writer, collectionContexts, options);
}

async function loadGeneratedMetadata(
  writer: LogWriter,
  objectContexts: Map<string, RecordLogContext>,
  directory: string = outputDir,
) {
  const metadataByUuid = new Map<string, SchemaMetadata>();
  const uuids = await listGeneratedUuids(directory, objectsFolder, true);

  for (const uuid of uuids) {
    try {
      const metadata = (await readGeneratedSchema(
        join(directory, objectsFolder, uuid),
      )) as Partial<SchemaMetadata>;
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
  oaiBaseUrl: string,
) {
  console.log("Generating IIIF Object Manifests...");
  const objects = objectResponse.records as SchemaRecord<"object">[];
  const recordsWithoutImages = new Set<string>();
  const encounteredUuids = new Set<string>();
  let generated = 0;

  const bar = new cliProgress.Bar({}, cliProgress.Presets.shades_classic);
  bar.start(objects.length, 0);

  for (const [index, record] of objects.entries()) {
    let context = getRecordLogContext(record, "objects", oaiBaseUrl);
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
        oaiBaseUrl,
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
}

export function parsePublicCollections(
  collectionResponse: FetchedRecords,
  writer: LogWriter,
  existingCollectionUuids: ReadonlySet<string>,
  oaiBaseUrl: string,
) {
  const collections = collectionResponse.records as SchemaRecord<"collection">[];
  const publicCollections: PublicCollection[] = [];

  for (const sourceCollection of collections) {
    const oaiIdentifier = sourceCollection.header?.identifier;
    let context = getRecordLogContext(sourceCollection, "collections", oaiBaseUrl);
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
        oaiBaseUrl,
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

function getChildCollections(collections: readonly PublicCollection[]) {
  const publicUuids = new Set(collections.map(({ uuid }) => uuid));
  const childrenByParent = new Map<string, Map<string, PublicCollection>>();
  for (const child of collections) {
    for (const parent of child.metadata.isPartOf ?? []) {
      if (parent["@type"] !== "Collection" || !parent.sameAs) continue;
      const parentUuid = getUuid(parent.sameAs);
      if (!parentUuid || parentUuid === child.uuid || !publicUuids.has(parentUuid)) continue;

      const children = childrenByParent.get(parentUuid) ?? new Map();
      children.set(child.uuid, child);
      childrenByParent.set(parentUuid, children);
    }
  }
  return childrenByParent;
}

export async function generateCollections(
  collections: readonly PublicCollection[],
  writer: LogWriter,
  manifestsOnDisk: Map<string, SchemaMetadata>,
  existingCollectionUuids: ReadonlySet<string>,
  loggedCollectionOmissionUuids: ReadonlySet<string>,
  oaiBaseUrl: string,
  directory = outputDir,
) {
  console.log("Generating IIIF Collection Manifests...");
  const childrenByParent = getChildCollections(collections);
  const statuses = new Map<string, "visiting" | "available" | "failed">();
  const generatedCollections: PublicCollection[] = [];
  const recordsInCollections = new Set<string>();
  let generated = 0;

  async function generateCollection(sourceCollection: PublicCollection) {
    const {
      metadata: parsedMetadata,
      oaiIdentifier,
      uuid,
    } = sourceCollection;
    if (statuses.has(uuid)) return;
    statuses.set(uuid, "visiting");

    const context = createRecordLogContext(
      uuid,
      parsedMetadata.name,
      parsedMetadata.identifier,
      oaiIdentifier === unavailable ? undefined : oaiIdentifier,
      "collections",
      oaiBaseUrl,
    );
    try {
      const children: PublicCollection[] = [];
      for (const child of childrenByParent.get(uuid)?.values() ?? []) {
        if (statuses.get(child.uuid) === "visiting") {
          writeRecordLog(
            writer,
            "Circular collection membership",
            "Child collection omitted",
            context,
            `Collection UUID: ${child.uuid}`,
          );
          continue;
        }

        await generateCollection(child);
        if (statuses.get(child.uuid) === "available") {
          children.push(child);
        } else {
          writeRecordLog(
            writer,
            "Child collection export is not available",
            "Child collection omitted",
            context,
            `Collection UUID: ${child.uuid}`,
          );
        }
      }

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

      const collection = createCollection(records, parsedMetadata, uuid, children);
      await saveJson(collection, uuid, join(directory, collectionsFolder));
      statuses.set(uuid, "available");
      generatedCollections.push(sourceCollection);
      generated++;
    } catch (error) {
      statuses.set(uuid, existingCollectionUuids.has(uuid) ? "available" : "failed");
      writeRecordLog(
        writer,
        "Generation failed for collection",
        getCollectionFailureConsequence(context, existingCollectionUuids),
        context,
        `Error: ${errorMessage(error)}`,
      );
    }
  }

  for (const collection of collections) {
    await generateCollection(collection);
  }

  // Children can finish before their parents. Finalize schema relationships
  // only once every collection's export (or fallback) outcome is known.
  for (const { metadata, uuid, oaiIdentifier } of generatedCollections) {
    const context = createRecordLogContext(
      uuid,
      metadata.name,
      metadata.identifier,
      oaiIdentifier === unavailable ? undefined : oaiIdentifier,
      "collections",
      oaiBaseUrl,
    );
    const { isPartOf, ...schemaMetadata } = metadata;
    const retainedParents: NonNullable<SchemaCollectionMetadata["isPartOf"]> = [];
    const removedParents: NonNullable<SchemaCollectionMetadata["isPartOf"]> = [];
    for (const parent of isPartOf ?? []) {
      const parentUuid = parent.sameAs ? getUuid(parent.sameAs) : undefined;
      if (parentUuid && statuses.get(parentUuid) === "available") {
        retainedParents.push(parent);
      } else {
        removedParents.push(parent);
      }
    }

    try {
      await saveJson(
        {
          "@context": "https://schema.org",
          "@type": "Collection",
          ...schemaMetadata,
          ...(retainedParents.length ? { isPartOf: retainedParents } : {}),
        },
        "schema",
        join(directory, collectionsFolder, uuid),
      );
      for (const parent of removedParents) {
        writeRecordLog(
          writer,
          "Referenced parent collection is not exported",
          "isPartOf reference removed from schema.json",
          context,
          `Parent collection: ${parent.name}; UUID: ${parent.sameAs ? getUuid(parent.sameAs) ?? unavailable : unavailable}; Reference: ${parent.sameAs ?? unavailable}`,
        );
      }
    } catch (error) {
      writeRecordLog(
        writer,
        "Schema export failed for collection",
        "IIIF collection available; schema.json not updated",
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

export async function runGenerate(options: GenerateOptions = {}) {
  const resolvedOptions = resolveGenerateOptions(options);
  const { oaiBaseUrl } = resolvedOptions;
  const writer: LogWriter = [];

  try {
    // Snapshot context is used only to identify records in deletion logs.
    const [previousObjectContexts, previousCollectionContexts] = await Promise.all([
      readPreviousLogContexts(objectsFolder, oaiBaseUrl),
      readPreviousLogContexts(collectionsFolder, oaiBaseUrl),
    ]);
    console.log("Fetching public collection and object inventories...");
    const harvestOptions = {
      oaiBaseUrl,
      useCache: resolvedOptions.collectiveAccessCache,
    };
    const collectionResponse = await fetchRecords("collections", harvestOptions);
    const objectResponse = await fetchRecords("objects", harvestOptions);
    const objectContexts = getRecordLogContexts(objectResponse.records, objectsFolder, oaiBaseUrl);
    const collectionContexts = getRecordLogContexts(
      collectionResponse.records,
      collectionsFolder,
      oaiBaseUrl,
    );
    const [existingManifestUuids, existingCollectionUuids] = await Promise.all([
      listGeneratedUuids(outputDir, objectsFolder),
      listGeneratedUuids(outputDir, collectionsFolder),
    ]);
    const manifestsOnDisk = await loadGeneratedMetadata(
      writer,
      objectContexts,
    );
    const publicCollections = parsePublicCollections(
      collectionResponse,
      writer,
      existingCollectionUuids,
      oaiBaseUrl,
    );
    const collectionMembership = getCollectionMembership(publicCollections);
    await generateObjects(
      objectResponse,
      resolvedOptions.dlcsCache,
      writer,
      manifestsOnDisk,
      existingManifestUuids,
      collectionMembership,
      oaiBaseUrl,
    );
    await reconcileUnavailableObjects(
      objectResponse,
      writer,
      manifestsOnDisk,
      new Map([...previousObjectContexts, ...objectContexts]),
      { delete: resolvedOptions.delete, oaiBaseUrl },
    );
    const loggedCollectionOmissionUuids =
      getLoggedCollectionOmissionUuids(writer);
    await generateCollections(
      publicCollections,
      writer,
      manifestsOnDisk,
      existingCollectionUuids,
      loggedCollectionOmissionUuids,
      oaiBaseUrl,
    );
    await reconcileUnavailableCollections(
      collectionResponse,
      writer,
      new Map([...previousCollectionContexts, ...collectionContexts]),
      { delete: resolvedOptions.delete, oaiBaseUrl },
    );
  } finally {
    const logPath = await writeCsvLog(
      sortRecordLogEntries(writer),
      recordLogColumns,
    );
    console.log(`Written log: ./${logPath}`);
  }
}
