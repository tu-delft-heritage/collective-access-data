import fs from "node:fs/promises";
import cliProgress from "cli-progress";
import {
  fetchRecords,
  fetchImageInformationWithCache,
  saveJson,
} from "./src/fetches";
import { createManifest, createCollection } from "./src/iiif";
import {
  getUuid,
  getValueAsArray,
  getOaiUrl,
  createWriter,
  date,
} from "./src/helpers.ts";
import { outputDir, objectsFolder, collectionsFolder } from "./src/settings";
import { SchemaMetadata, SchemaCollectionMetadata } from "./src/schema.ts";
import * as z from "zod";
import { join } from "node:path";

import type { IIIFImageInformation, SchemaRecord } from "./src/schema.ts";

// End process correctly
process.on("SIGINT", () => {
  console.log("Ctrl-C was pressed");
  process.exit();
});

// Clean output directory
await fs.rm("build", { recursive: true, force: true });

const writer = await createWriter();

const buildManifests = true;
const buildCollections = true;

// Get Collective Access objects
console.log("Generating IIIF Object Manifests...");
const objects = (await fetchRecords("objects")) as SchemaRecord<"object">[];

const manifestsOnDisk: Map<string, SchemaMetadata> = new Map();
const recordsWithoutImages: Map<string, SchemaMetadata> = new Map();

if (buildManifests) {
  writer.write("### OBJECTS ###\n---\n");

  // Write IIIF Object Manifests
  const bar = new cliProgress.Bar({}, cliProgress.Presets.shades_classic);
  bar.start(objects.length, 0);

  for (const [index, record] of objects.entries()) {
    const metadata = record.metadata?.RDF?.CreativeWork;
    const identifier = record.header?.identifier;

    if (!metadata) {
      writer.write(`No metadata found for record ${identifier}\n---\n`);
      continue;
    }

    const result = SchemaMetadata.safeParse(metadata);

    if (!result.success) {
      const error = z.prettifyError(result.error);
      const url = getOaiUrl(identifier, "objects");
      writer.write(
        `Parser failed for object ${identifier}:\n${error}\n${url}\n---\n`,
      );
      continue;
    }

    const parsedMetadata = result.data;
    const uuid = z.uuid().parse(getUuid(parsedMetadata["@id"]));
    const images = getValueAsArray(parsedMetadata.image);

    if (!images.length) {
      writer.write(`No images found for record: ${uuid}\n---\n`);
      if (recordsWithoutImages.has(uuid)) {
        writer.write(`Duplicate record exported for: ${uuid}\n---\n`);
      }
      recordsWithoutImages.set(uuid, parsedMetadata);
      continue;
    }

    const imageInformation = (
      await Promise.all(
        images.map((image) => {
          const uuid = z.uuid().parse(getUuid(image.contentUrl["@id"]));
          return fetchImageInformationWithCache(uuid);
        }),
      )
    ).filter((resp) => {
      if (resp.error) {
        writer.write(`Image not found: ${resp.error}\n---\n`);
        return false;
      } else return true;
    }) as IIIFImageInformation[];
    if (imageInformation.length) {
      const manifest = createManifest(imageInformation, parsedMetadata, uuid);

      // Save manifest & schema.json
      await saveJson(manifest, uuid, join(outputDir, objectsFolder));
      await saveJson(
        parsedMetadata,
        "schema",
        join(outputDir, objectsFolder, uuid),
      );
      bar.update(index + 1);
      if (manifestsOnDisk.has(uuid)) {
        writer.write(`Duplicate record exported for: ${uuid}\n---\n`);
      }
      manifestsOnDisk.set(uuid, parsedMetadata);
    }
  }
  bar.stop();
  console.log(`${manifestsOnDisk.size} manifests created`);
  if (recordsWithoutImages.size) {
    console.log(`No images found for the following records:`);
    console.table([...recordsWithoutImages.keys()]);
  }
}

// Get Collective Access collections
console.log("Generating IIIF Collection Manifests...");
const collections = (await fetchRecords(
  "collections",
)) as SchemaRecord<"collection">[];

if (buildCollections) {
  writer.write("### COLLECTIONS ###\n---\n");

  // Writing IIIF Collection Manifests
  const recordsInCollections: Set<string> = new Set();
  for (const collection of collections) {
    const metadata = collection.metadata.RDF.CreativeWork;
    const identifier = collection.header.identifier;

    const result = SchemaCollectionMetadata.safeParse(metadata);

    if (!result.success) {
      const error = z.prettifyError(result.error);
      const url = getOaiUrl(identifier, "collections");
      writer.write(
        `Parser failed for collection ${identifier}:\n${error}\n${url}\n---\n`,
      );
      continue;
    }

    const parsedMetadata = result.data;
    const uuid = z.uuid().parse(getUuid(parsedMetadata["@id"]));

    const label = parsedMetadata.name;
    const records = getValueAsArray(parsedMetadata.hasPart)
      .map((entity) => {
        if (entity.sameAs) {
          const uuid = z.uuid().parse(getUuid(entity.sameAs));
          if (manifestsOnDisk.has(uuid)) {
            if (recordsInCollections.has(uuid)) {
              writer.write(
                `Object is in multiple collections: ${uuid}:\n---\n`,
              );
            } else {
              recordsInCollections.add(uuid);
            }
            return manifestsOnDisk.get(uuid);
          }
        } else {
          writer.write(`Can't find object manifest for: ${uuid}:\n---\n`);
        }
      })
      .filter(Boolean) as SchemaMetadata[];
    if (records.length) {
      const collection = createCollection(records, parsedMetadata, uuid);
      saveJson(collection, uuid, join(outputDir, collectionsFolder));
    } else {
      writer.write(`No objects found for collection: ${uuid}:\n---\n`);
    }
  }
  console.log(
    `${recordsInCollections.size} records have been added to collections`,
  );
}

// Write log
writer.flush();
writer.end();
console.log(`Written log: ./logs/${date}.txt`);

// Todo: media check
// const media = (await fetchRecords("media")) as Record[];
