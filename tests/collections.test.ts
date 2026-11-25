import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  generateCollections,
  parsePublicCollections,
  type RecordLogEntry,
} from "../src/generate.ts";
import { OAIBaseUrl, manifestUriBase } from "../src/settings.ts";

const parentUuid = "11111111-1111-4111-8111-111111111111";
const childUuid = "22222222-2222-4222-8222-222222222222";
const emptyUuid = "33333333-3333-4333-8333-333333333333";
const invalidUuid = "44444444-4444-4444-8444-444444444444";
const secondParentUuid = "55555555-5555-4555-8555-555555555555";
const sourceUrl = (uuid: string) =>
  `https://heritage.tudelft.nl/iiif/collections/${uuid}/schema.json`;
const collectionUrl = (uuid: string) => `${manifestUriBase}collections/${uuid}.json`;

function record(uuid: string, properties: Record<string, unknown> = {}) {
  return {
    header: { identifier: `oai:test:${uuid}` },
    metadata: {
      RDF: {
        CreativeWork: {
          "@id": sourceUrl(uuid),
          name: "Test collection",
          identifier: uuid,
          description: "A collection description",
          ...properties,
        },
      },
    },
  };
}

function parentReference(uuid: string) {
  return { name: "Parent", sameAs: { resource: sourceUrl(uuid) } };
}

function image(position: number) {
  return {
    contentUrl: {
      "@context": "http://iiif.io/api/presentation/3/context.json",
      "@id": `https://example.test/iiif/${position}`,
      "@type": "Image",
    },
    thumbnailUrl: `https://example.test/thumbnails/${position}.jpg`,
    encodingFormat: "https://iiif.io/api/image/3.0/",
    width: "1600",
    height: "1200",
    position: String(position),
  };
}

test("exports schema and IIIF for nested and empty collections", async () => {
  const directory = await mkdtemp(join(tmpdir(), "collective-access-collections-"));
  const log: RecordLogEntry[] = [];
  const abstract = "First summary line\n\nSecond summary line";
  const description =
    "First description line \r\n\t\r\n Second description line\rThird description line";
  const collectionDir = join(directory, "collections");

  try {
    const collections = parsePublicCollections({
      usedCachedResponse: false,
      records: [
        record(parentUuid, { abstract, description }),
        record(secondParentUuid, {
          abstract: " \t",
          description: "\n  Fallback summary \n\n More detail\n",
        }),
        record(childUuid, {
          name: "Child",
          isPartOf: { Collection: [
            parentReference(parentUuid),
            parentReference(parentUuid),
            parentReference(secondParentUuid),
          ] },
          image: { ImageObject: [image(2), image(1)] },
        }),
        record(emptyUuid),
        record(invalidUuid, {
          name: undefined,
          isPartOf: { Collection: parentReference(parentUuid) },
        }),
      ],
    }, log, new Set(), OAIBaseUrl);

    await generateCollections(
      collections, log, new Map(), new Set(), new Set(), OAIBaseUrl, directory,
    );

    const parent = await Bun.file(join(collectionDir, `${parentUuid}.json`)).json();
    const child = await Bun.file(join(collectionDir, `${childUuid}.json`)).json();
    const secondParent = await Bun.file(join(collectionDir, `${secondParentUuid}.json`)).json();
    const empty = await Bun.file(join(collectionDir, `${emptyUuid}.json`)).json();
    const parentSchema = await Bun.file(join(collectionDir, parentUuid, "schema.json")).json();
    const childSchema = await Bun.file(join(collectionDir, childUuid, "schema.json")).json();

    expect(parent.summary).toEqual({ nl: ["First summary line", "Second summary line"] });
    expect(parent.metadata).toContainEqual({
      label: { en: ["Description"], nl: ["Beschrijving"] },
      value: {
        nl: ["First description line", "Second description line", "Third description line"],
      },
    });
    expect(parent.items).toEqual([{
      id: collectionUrl(childUuid),
      type: "Collection",
      label: { nl: ["Child"] },
      thumbnail: child.thumbnail,
    }]);
    expect(secondParent.items).toEqual(parent.items);
    expect(secondParent.summary).toEqual({ nl: ["Fallback summary"] });
    expect(child.thumbnail).toEqual([1, 2].map((position) => ({
      id: image(position).thumbnailUrl,
      type: "Image",
      format: "image/jpeg",
    })));
    expect(empty.items).toEqual([]);
    expect(empty.summary).toEqual({ nl: ["A collection description"] });
    expect(empty.metadata).toHaveLength(2);
    expect(parentSchema).toMatchObject({
      "@context": "https://schema.org",
      "@type": "Collection",
      "@id": sourceUrl(parentUuid),
      abstract,
      description:
        "First description line \n Second description line\nThird description line",
    });
    expect(childSchema.isPartOf[0].sameAs).toBe(sourceUrl(parentUuid));
    expect(childSchema.image.map(({ position }: { position: number }) => position)).toEqual([1, 2]);
    expect(await Bun.file(join(collectionDir, emptyUuid, "schema.json")).exists()).toBe(true);
    expect(await Bun.file(join(collectionDir, `${invalidUuid}.json`)).exists()).toBe(false);
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({ uuid: invalidUuid, message: "Parser failed for collection" });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("exports collection roles, documentation, dates, extent, and member images from OAI", async () => {
  const directory = await mkdtemp(join(tmpdir(), "collective-access-collection-metadata-"));
  const log: RecordLogEntry[] = [];
  const collectionDir = join(directory, "collections");
  const institution = { name: "Example faculty" };
  const curator = { name: "Example curator" };
  const contributor = (roleName: string, entities: Record<string, unknown>) => ({
    Role: { roleName, Contributor: entities },
  });
  const citationUrl = "https://example.test/catalogue?edition=1&language=nl";
  const memberUrl = `https://heritage.tudelft.nl/iiif/manifests/${childUuid}/schema.json`;
  const contentUrl = [image(1).contentUrl, image(2).contentUrl];

  try {
    const collections = parsePublicCollections({
      usedCachedResponse: false,
      records: [record(parentUuid, {
        description: undefined,
        identifier: "test-collection",
        temporalCoverage: "1700/2010",
        materialExtent: "630 objecten",
        citation: [
          { CreativeWork: { sameAs: undefined } },
          { CreativeWork: { name: "Example catalogue", sameAs: { resource: citationUrl } } },
        ],
        creator: { Role: { roleName: "beherende instelling", Creator: { Organization: institution } } },
        contributor: [
          contributor("collectieverantwoordelijke", { Person: curator, Organization: institution }),
          contributor("institutionele herkomst", { Person: curator }),
          contributor("institutionele herkomst", { Organization: institution }),
        ],
        hasPart: {
          CreativeWork: { name: "Example member", sameAs: { resource: memberUrl } },
          image: { ImageObject: { contentUrl } },
        },
      })],
    }, log, new Set(), OAIBaseUrl);

    await generateCollections(
      collections, log, new Map(), new Set(), new Set(), OAIBaseUrl, directory,
    );

    const collection = await Bun.file(join(collectionDir, `${parentUuid}.json`)).json();
    const schema = await Bun.file(join(collectionDir, parentUuid, "schema.json")).json();
    expect(collection.summary).toBeUndefined();
    expect(collection.metadata).toEqual([
      { label: { en: ["Title"], nl: ["Titel"] }, value: { nl: ["Test collection"] } },
      { label: { en: ["Dating"], nl: ["Datering"] }, value: { nl: ["1700 – 2010"] } },
      { label: { en: ["Extent"], nl: ["Omvang"] }, value: { nl: ["630 objecten"] } },
      { label: { en: ["Managing institution"], nl: ["Beherende instelling"] }, value: { nl: [institution.name] } },
      { label: { en: ["Curator"], nl: ["Conservator"] }, value: { nl: [curator.name, institution.name] } },
      {
        label: { en: ["Institutional provenance"], nl: ["Institutionele herkomst"] },
        value: { nl: [curator.name, institution.name] },
      },
      {
        label: { en: ["Documentation"], nl: ["Documentatie"] },
        value: {
          nl: [
            '<span><a href="https://example.test/catalogue?edition=1&amp;language=nl">Example catalogue</a></span>',
          ],
        },
      },
    ]);
    expect(schema).toMatchObject({
      identifier: "test-collection",
      temporalCoverage: "1700/2010",
      materialExtent: "630 objecten",
      citation: [{ "@type": "CreativeWork", name: "Example catalogue", sameAs: citationUrl }],
      creator: {
        "@type": "Role",
        roleName: "beherende instelling",
        creator: { "@type": "Organization", ...institution },
      },
      hasPart: {
        "@type": "CreativeWork",
        name: "Example member",
        sameAs: memberUrl,
        image: { "@type": "ImageObject", contentUrl },
      },
    });
    expect(schema.contributor[0]).toEqual({
      "@type": "Role",
      roleName: "collectieverantwoordelijke",
      contributor: [{ "@type": "Person", ...curator }, { "@type": "Organization", ...institution }],
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
