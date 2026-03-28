import fs from "node:fs/promises";
import cliProgress from "cli-progress";
import {
  fetchRecords,
  fetchImageInformationWithCache,
  saveJson,
} from "./src/fetches";
import { createManifest, createCollection } from "./src/iiif";
import { getUuid, getValueAsArray, getUrlForObject } from "./src/helpers.ts";
import { outputDir, objectsFolder, collectionsFolder } from "./src/settings";
import { SchemaMetadata } from "./src/types";
import { date, writer } from "./src/log.ts";
import * as z from "zod";

import type { IIIFImageInformation, SchemaRecord } from "./src/types";

// End process correctly
process.on("SIGINT", () => {
  console.log("Ctrl-C was pressed");
  process.exit();
});

// Clean output directory
await fs.rm("build", { recursive: true, force: true });

const buildManifests = true;
const buildCollections = false;

// Get Collective Access objects
console.log("Generating IIIF Object Manifests...");
const objects = (await fetchRecords("objects")) as SchemaRecord<"object">[];

if (buildManifests) {
  // Write IIIF Object Manifests
  const bar = new cliProgress.Bar({}, cliProgress.Presets.shades_classic);
  bar.start(objects.length, 0);
  const manifestsOnDisk = new Array();
  const recordsWithoutImages = new Array();
  const failedImages = new Array();
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
      const url = getUrlForObject(identifier);
      writer.write(`Parser failed for ${identifier}:\n${error}\n${url}\n---\n`);
      continue;
    }
    const parsedMetadata = result.data;
    const uuid = getUuid(parsedMetadata["@id"]) as string;

    await saveJson(parsedMetadata, uuid + "/schema", outputDir + objectsFolder);
    continue;
    const images = getValueAsArray(parsedMetadata.image);
    if (images?.length) {
      const imageInformation = (
        await Promise.all(
          images.map((i) => fetchImageInformationWithCache(i.uuid)),
        )
      ).filter((resp) => {
        if (resp.error) {
          failedImages.push(resp.error);
          return false;
        } else return true;
      }) as IIIFImageInformation[];
      if (imageInformation.length) {
        const manifest = createManifest(imageInformation, metadata, uuid);
        await saveJson(manifest, uuid, outputDir + objectsFolder);
        bar.update(index + 1);
        manifestsOnDisk.push(uuid);
      }
    } else {
      recordsWithoutImages.push(uuid);
    }
  }
  bar.stop();
  console.log(`${manifestsOnDisk.length} manifests created`);
  if (recordsWithoutImages.length) {
    console.log(`No images found for the following records:`);
    console.table(recordsWithoutImages);
  }
  if (failedImages.length) {
    console.log(`Information for the following images could not be fetched:`);
    console.table(failedImages);
  }
}

// Get Collective Access collections
console.log("Generating IIIF Collection Manifests...");
const collections = (await fetchRecords(
  "collections",
)) as SchemaRecord<"collection">[];

if (buildCollections) {
  // Writing IIIF Collection Manifests
  const recordsInCollections = new Array();
  for (const collection of collections) {
    const metadata = collection.metadata[0]["qdc:dc"][0];
    const label = metadata["dc:title"][0];
    const uuid = metadata["dc:isVersionOf"][0];
    const records = metadata["dc:hasPart"]
      ?.filter((part) => {
        const isPublic = part["dc:accessRights"][0] === "public_access";
        const uuid = part["dc:isVersionOf"][0];
        if (isPublic && manifestsOnDisk.includes(uuid)) {
          recordsInCollections.push(uuid);
          return true;
        }
      })
      .map((part) => {
        const uuid = part["dc:isVersionOf"][0];
        const object = objects.find(
          (object) =>
            object.metadata[0]["qdc:dc"][0]["dc:isVersionOf"][0] === uuid,
        );
        return object?.metadata[0]["qdc:dc"][0];
      });
    if (records?.length) {
      const collection = createCollection(records, metadata, uuid);
      saveJson(collection, uuid, outputDir + collectionsFolder);
    } else {
      console.log(`No records found for ${label} (${uuid})`);
    }
  }
  console.log(
    `${recordsInCollections.length} records have been added to collections`,
  );
}

// Write log
writer.flush();
writer.end();

// Todo: media check
// const media = (await fetchRecords("media")) as Record[];
