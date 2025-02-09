import { IIIFBuilder } from "@iiif/builder";
import he from "he";
import { manifestUriBase, labels } from "./settings";
import type { Metadata, IIIFImageInformation, Part } from "./types";

function parseMetadata(props: Metadata) {
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

function decodeLabel(label: string[]) {
  return label.map((i) => he.decode(i));
}

export function createManifest(
  images: IIIFImageInformation[],
  metadata: Metadata,
  uuid: string
) {
  const builder = new IIIFBuilder();
  const uri = manifestUriBase + "manifests/" + uuid;
  const manifest = builder.createManifest(uri + ".json", (manifest) => {
    manifest.setLabel({ nl: decodeLabel(metadata["dc:title"]) });
    manifest.setMetadata(parseMetadata(metadata));
    if (images.length) {
      for (const [index, item] of images.entries()) {
        manifest.createCanvas(uri + "/canvas/" + index, (canvas) => {
          canvas.height = item.height;
          canvas.width = item.width;
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

export function createCollection(records: Part[], label: string, id: string) {
  const builder = new IIIFBuilder();
  const uri = manifestUriBase + id;
  const collection = builder.createCollection(uri + ".json", (collection) => {
    collection.setLabel({ nl: [label] });
    if (records.length) {
      for (const item of records) {
        const uuid = item["dc:isVersionOf"][0];
        collection.createManifest(
          manifestUriBase + "manifests/" + uuid + ".json",
          (manifest) => {
            manifest.setLabel({ nl: decodeLabel(item["dc:type"]) });
          }
        );
      }
    }
  });
  return builder.toPresentation3(collection);
}
