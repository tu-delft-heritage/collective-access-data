import { IIIFBuilder } from "@iiif/builder";
import he from "he";
import {
  manifestUriBase,
  objectLabels,
  collectionLabels,
  objectsFolder,
  collectionsFolder,
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
  records: Part[],
  metadata: Metadata,
  uuid: string
) {
  const builder = new IIIFBuilder();
  const uri = manifestUriBase + collectionsFolder + uuid;
  const collection = builder.createCollection(uri + ".json", (collection) => {
    collection.setLabel({ nl: decodeValue(metadata["dc:title"]) });
    collection.setSummary({ nl: decodeValue(metadata["dc:description"]) });
    collection.setMetadata(parseMetadata(metadata, "collection"));
    if (records.length) {
      for (const item of records) {
        const uuid = item["dc:isVersionOf"][0];
        collection.createManifest(
          manifestUriBase + objectsFolder + uuid + ".json",
          (manifest) => {
            manifest.setLabel({ nl: decodeValue(item["dc:type"]) });
          }
        );
      }
    }
  });
  return builder.toPresentation3(collection);
}
