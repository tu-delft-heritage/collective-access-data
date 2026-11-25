import { IIIFBuilder } from "@iiif/builder";
import {
  manifestUriBase,
  objectMapping,
  collectionMapping,
  objectsFolder,
  collectionsFolder,
  getCollectionDescriptionLines,
} from "./settings";
import { getUuid } from "./helpers";
import type {
  IIIFImageInformation,
  SchemaMetadata,
  SchemaCollectionMetadata,
} from "./schema";

function parseMetadata<T>(
  props: T,
  mapping: readonly {
    label: { en: string[]; nl: string[] };
    getValue: (props: T) => string[] | undefined;
  }[],
) {
  return mapping.flatMap(({ label, getValue }) => {
    const nl = getValue(props);
    return nl?.length ? [{ label, value: { nl } }] : [];
  });
}

function getNavDateValue(metadata: SchemaMetadata) {
  const date = metadata.temporalCoverage;
  const parseDate = (s: string) => new Date(Date.parse(s)).toISOString();
  try {
    let isoString: null | string = null;
    if (date) {
      const firstYear = date.slice(0, 4);
      isoString = parseDate(firstYear);
    }
    return isoString;
  } catch {
    return null;
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
    manifest.setMetadata(parseMetadata(metadata, objectMapping));
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
            type: "Image" as const,
            format: "image/jpeg",
            service: [
              {
                "@context": "http://iiif.io/api/image/3/context.json",
                id: item.id.replace("iiif-img", "thumbs"),
                type: "ImageService3" as const,
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
                  type: "ImageService3" as const,
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
  records: readonly SchemaMetadata[],
  metadata: SchemaCollectionMetadata,
  uuid: string,
  children: readonly { uuid: string; metadata: SchemaCollectionMetadata }[] = [],
) {
  const builder = new IIIFBuilder();
  const uri = `${manifestUriBase}${collectionsFolder}/${uuid}`;
  const summary = metadata.abstract?.trim()
    ? metadata.abstract.split(/(?:\r?\n)+/)
    : getCollectionDescriptionLines(metadata.description).slice(0, 1);
  const collection = builder.createCollection(`${uri}.json`, (collection) => {
    collection.setLabel({ nl: [metadata.name] });
    if (summary.length) {
      collection.setSummary({ nl: summary });
    }
    collection.setMetadata(parseMetadata(metadata, collectionMapping));
    for (const thumbnail of getCollectionThumbnails(metadata)) {
      collection.addThumbnail(thumbnail);
    }
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
    for (const child of children) {
      collection.createCollection(
        `${manifestUriBase}${collectionsFolder}/${child.uuid}.json`,
        (reference) => {
          reference.setLabel({ nl: [child.metadata.name] });
          for (const thumbnail of getCollectionThumbnails(child.metadata)) {
            reference.addThumbnail(thumbnail);
          }
        },
      );
    }
  });
  const result = builder.toPresentation3(collection) as Record<string, unknown>;
  // The builder omits empty arrays, but IIIF Collections require `items`.
  result.items ??= [];
  return result;
}

function getCollectionThumbnails(metadata: SchemaCollectionMetadata) {
  return (metadata.image ?? []).map(({ thumbnailUrl }) => ({
    id: thumbnailUrl,
    type: "Image" as const,
    format: "image/jpeg",
  }));
}
