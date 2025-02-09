import cliProgress from "cli-progress";
import {
  fetchRecords,
  fetchImageInformationWithCache,
  saveJson,
} from "./src/fetches";
import { createManifest, createCollection } from "./src/iiif";
import { outputDir } from "./src/settings";

import type { Record, Image, IIIFImageInformation } from "./src/types";

// End process correctly
process.on("SIGINT", () => {
  console.log("Ctrl-C was pressed");
  process.exit();
});

// Get Collective Access objects
const objects = (await fetchRecords("objects")) as Record[];

// Write IIIF Object Manifests
console.log("Generating IIIF Manifests...");
const multibar = new cliProgress.MultiBar(
  { hideCursor: true },
  cliProgress.Presets.shades_classic
);
const bar = multibar.create(objects.length, 0);
const manifestsOnDisk = new Array();
for (const [index, record] of objects.entries()) {
  const metadata = record.metadata[0]["qdc:dc"][0];
  const uuid = metadata["dc:isVersionOf"][0];
  const images = metadata["dc:image"]
    ?.map((i: Image) => ({
      uuid: i["dc:isVersionOf"]?.[0],
      name: i["dc:identifier"]?.[0],
      sort: +i["dc:tableOfContents"]?.[0],
      access: i["dc:accessRights"]?.[0],
    }))
    // Filter for public images
    .filter((i: any) => i.access === "public_access")
    // Sort the images
    .sort((a: any, b: any) => a.sort - +b.sort);
  if (images && images.length) {
    const imageInformation = (await Promise.all(
      images.map((i: any) => fetchImageInformationWithCache(i.uuid))
    )) as IIIFImageInformation[];
    if (imageInformation.length) {
      const manifest = createManifest(imageInformation, metadata, uuid);
      await saveJson(manifest, uuid, outputDir + "/manifests");
      bar.update(index + 1);
      manifestsOnDisk.push(uuid);
    }
  } else {
    multibar.log(`Record ${uuid} does not have any public images \n`);
  }
}
multibar.stop();
console.log(`${manifestsOnDisk.length} manifests created`);

// Get Collective Access collections
const collections = (await fetchRecords("collections")) as Record[];
console.log(`${collections.length} collections found`);

// Writing IIIF Collection Manifests
const recordsInCollections = new Array();
for (const collection of collections) {
  const metadata = collection.metadata[0]["qdc:dc"][0];
  const label = metadata["dc:title"][0];
  const uuid = metadata["dc:isVersionOf"][0];
  const records = metadata["dc:hasPart"]?.filter((part) => {
    const access = part["dc:accessRights"][0];
    const uuid = part["dc:isVersionOf"][0];
    if (access === "public_access") {
      if (manifestsOnDisk.includes(uuid)) {
        recordsInCollections.push(uuid);
        return true;
      } else {
        // Already logged above
        // console.log(`${uuid}) is not found on disk`);
      }
    }
  });
  if (records && records.length) {
    const collection = createCollection(records, label, uuid);
    saveJson(collection, uuid, outputDir + "collections/");
  } else {
    console.log(`${label} (${uuid}) has no parts`);
  }
}
console.log(`${recordsInCollections.length} records in collections`);
