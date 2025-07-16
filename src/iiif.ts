import { IIIFBuilder } from "@iiif/builder";
import he from "he";
import {
  manifestUriBase,
  objectLabels,
  collectionLabels,
  objectsFolder,
  collectionsFolder,
  collectionMetadata,
} from "./settings";
import type { Metadata, IIIFImageInformation, Part } from "./types";

function parseMetadata(props: Metadata, type?: string) {
  const labels = type === "collection" ? collectionLabels : objectLabels;
  const metadata = new Array();
  for (const [key, label] of Object.entries(labels)) {
    const value = props[key] as string[];
    if (value) {
      metadata.push({
        label,
        value: {
          // Decoding because of encoded ampersands in string
          nl: value.map((i) => he.decode(i)),
        },
      });
    }
  }
  return metadata;
}

function decodeValue(value: string[]) {
  return value.map((i) => (i ? he.decode(i) : i));
}

function createNavDate(metadata: Metadata) {
  const date = metadata["dc:date"]?.[0];
  const uuid = metadata["dc:isVersionOf"][0];
  const parseDate = (s: string) => new Date(Date.parse(s)).toISOString();
  try {
    let isoString: null | string = null;
    if (date) {
      if (date === "mid 19th century") {
        isoString = parseDate("1850");
      } else if (date.includes("–")) {
        // Use start year of period
        const firstYear = date.split("–")[0].trim();
        isoString = parseDate(firstYear);
      } else if (date.includes("after")) {
        const year = date.split("after ")[1].trim();
        isoString = parseDate(year);
      } else {
        // To remove trailing s of 1870s
        const year = date.slice(0, 4);
        isoString = parseDate(year);
      }
    }
    return isoString;
  } catch (err) {
    console.log(`Could not process date for ${uuid} ${date}`);
  }
}

export function createManifest(
  images: IIIFImageInformation[],
  metadata: Metadata,
  uuid: string
) {
  const builder = new IIIFBuilder();
  const uri = manifestUriBase + objectsFolder + uuid;
  const manifest = builder.createManifest(uri + ".json", (manifest) => {
    manifest.setLabel({ nl: decodeValue(metadata["dc:title"]) });
    manifest.setMetadata(parseMetadata(metadata, "object"));
    const navDate = createNavDate(metadata);
    if (navDate) {
      manifest.entity.navDate = navDate;
    }
    if (images.length) {
      for (const [index, item] of images.entries()) {
        manifest.createCanvas(uri + "/canvas/" + index, (canvas) => {
          canvas.height = item.height;
          canvas.width = item.width;
          const thumbnail = {
            id:
              item.id.replace("iiif-img", "thumbs") + "/full/max/0/default.jpg",
            type: "Image",
            format: "image/jpeg",
            service: [
              {
                "@context": "http://iiif.io/api/image/3/context.json",
                id: item.id.replace("iiif-img", "thumbs"),
                type: "ImageService3",
                profile: "level0",
                sizes: item.sizes,
              },
            ],
          };
          if (index === 0) {
            manifest.addThumbnail(thumbnail);
          }
          canvas.addThumbnail(thumbnail);
          canvas.createAnnotation(item.id, {
            id: item.id,
            type: "Annotation",
            motivation: "painting",
            body: {
              id: item.id + "/full/max/0/default.jpg",
              type: "Image",
              format: "image/jpeg",
              height: item.height,
              width: item.width,
              service: [
                {
                  "@context": item["@context"],
                  id: item.id,
                  type: item.type,
                  profile: item.profile,
                },
              ],
            },
          });
        });
      }
    }
  });
  return builder.toPresentation3(manifest);
}

export function createCollection(
  records: Metadata[],
  metadata: Metadata,
  uuid: string
) {
  const builder = new IIIFBuilder();
  const uri = manifestUriBase + collectionsFolder + uuid;
  const collection = builder.createCollection(uri + ".json", (collection) => {
    collection.setLabel({ nl: decodeValue(metadata["dc:title"]) });
    collection.setSummary({ nl: decodeValue(metadata["dc:description"]) });
    collection.setMetadata(collectionMetadata);
    if (records.length) {
      for (const item of records) {
        const uuid = item["dc:isVersionOf"][0];
        collection.createManifest(
          manifestUriBase + objectsFolder + uuid + ".json",
          (manifest) => {
            manifest.setLabel({ nl: decodeValue(item["dc:title"]) });
            const navDate = createNavDate(item);
            if (navDate) {
              manifest.entity.navDate = navDate;
            }
          }
        );
      }
    }
  });
  return builder.toPresentation3(collection);
}
