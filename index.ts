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
const bar = new cliProgress.SingleBar({}, cliProgress.Presets.shades_classic);
bar.start(objects.length, 0);
for (const [index, record] of objects.entries()) {
  const metadata = record.metadata[0]["qdc:dc"][0];
  const uuid = metadata["dc:isVersionOf"][0];
  const images = metadata["dc:image"];
  if (images) {
    const imageInformation = (await Promise.all(
      images
        .map((i: Image) => ({
          uuid: i["dc:isVersionOf"]?.[0],
          name: i["dc:identifier"]?.[0],
          sort: +i["dc:tableOfContents"]?.[0],
          access: i["dc:accessRights"]?.[0],
        }))
        // Filter for public images
        .filter((i: any) => i.access === "public_access")
        // Sort the images
        .sort((a: any, b: any) => a.sort - +b.sort)
        .map((i: any) => fetchImageInformationWithCache(i.uuid))
        // Filter for successful responses
        .filter((i: any) => i && i?.status !== 404)
    )) as IIIFImageInformation[];
    if (imageInformation.length) {
      const manifest = createManifest(imageInformation, metadata, uuid);
      await saveJson(manifest, uuid, outputDir + "/manifests");
      bar.update(index + 1);
    }
  } else {
    console.log(`Record ${uuid} does not have any public images`);
  }
}
bar.stop();

// Get Collective Access collections
const collections = (await fetchRecords("collections")) as Record[];
console.log(`Found ${collections.length} collections`);

// Writing IIIF Collection Manifests
for (const collection of collections) {
  const metadata = collection.metadata[0]["qdc:dc"][0];
  const label = metadata["dc:title"][0];
  const uuid = metadata["dc:isVersionOf"][0];
  // Todo: filter for images
  const records = metadata["dc:hasPart"]?.filter(
    (part) => part["dc:accessRights"][0] === "public_access"
  );
  if (records) {
    const collection = createCollection(records, label, uuid);
    saveJson(collection, uuid, outputDir + "collections/");
  } else {
    console.log(`Collection ${uuid} has no parts`);
  }
}

// List all collections (1 fetch)
// Create mapping between objects and collections
// Create subfolders and collection ymls
// List all records (with resumptionToken; 7 fetches)
// Place in the right folder
