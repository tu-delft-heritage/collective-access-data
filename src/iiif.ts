import { IIIFBuilder } from "@iiif/builder";
import {
  manifestUriBase,
  objectMapping,
  collectionMapping,
  objectsFolder,
  collectionsFolder,
  collectionMetadata,
} from "./settings";
import { getUuid } from "./helpers";
import type {
  IIIFImageInformation,
  SchemaMetadata,
  SchemaCollectionMetadata,
  SchemaEntity,
} from "./schema";
import * as z from "zod";

type Metadata = z.input<typeof SchemaMetadata>;

function parseMetadata(props: SchemaMetadata, type?: string) {
  const labels = type === "collection" ? collectionMapping : objectMapping;
  const metadata = new Array();
  for (const { label, getValue } of labels) {
    const value = getValue(props);
    if (value) {
      metadata.push({
        label,
        value: {
          nl: value,
        },
      });
    }
  }
  return metadata;
}

function getNavDateValue(metadata: SchemaMetadata) {
  const date = metadata.temporalCoverage;
  const uuid = getUuid(metadata["@id"]);
  const parseDate = (s: string) => new Date(Date.parse(s)).toISOString();
  try {
    let isoString: null | string = null;
    if (date) {
      const firstYear = date.slice(0, 4);
      isoString = parseDate(firstYear);
    }
    return isoString;
  } catch (err) {
    console.log(`Could not process date for ${uuid} ${date}`);
  }
}

export function createManifest(
  images: IIIFImageInformation[],
  metadata: SchemaMetadata,
  uuid: string,
) {
  const builder = new IIIFBuilder();
  const uri = `${manifestUriBase}${objectsFolder}/${uuid}`;
  const manifest = builder.createManifest(`${uri}.json`, (manifest) => {
    manifest.setLabel({ nl: [metadata.name] });
    manifest.setMetadata(parseMetadata(metadata, "object"));
    const navDate = getNavDateValue(metadata);
    if (navDate) {
      manifest.entity.navDate = navDate;
    }
    if (images.length) {
      for (const [index, item] of images.entries()) {
        manifest.createCanvas(`${uri}/canvas/${index}`, (canvas) => {
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
  records: SchemaMetadata[],
  metadata: SchemaCollectionMetadata,
  uuid: string,
) {
  const builder = new IIIFBuilder();
  const uri = `${manifestUriBase}${collectionsFolder}/${uuid}`;
  const collection = builder.createCollection(`${uri}.json`, (collection) => {
    collection.setLabel({ nl: [metadata.name] });
    collection.setSummary({ nl: [metadata.description] });
    collection.setMetadata(collectionMetadata);
    if (records.length) {
      for (const item of records) {
        const uuid = getUuid(item["@id"]);
        collection.createManifest(
          `${manifestUriBase}${objectsFolder}/${uuid}.json`,
          (manifest) => {
            manifest.setLabel({ nl: [item.name] });
            const navDate = getNavDateValue(item);
            if (navDate) {
              manifest.entity.navDate = navDate;
            }
          },
        );
      }
    }
  });
  return builder.toPresentation3(collection);
}
