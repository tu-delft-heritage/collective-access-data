import { describe, expect, test } from "bun:test";
import { createManifest } from "../src/iiif.ts";
import type { SchemaMetadata } from "../src/schema.ts";

describe("IIIF object manifest", () => {
  test("links documentation titles with IIIF-compatible citation URLs", () => {
    const uuid = "11111111-1111-4111-8111-111111111111";
    const metadata: SchemaMetadata = {
      "@context": "https://schema.org",
      "@type": "CreativeWork",
      "@id": `https://heritage.tudelft.nl/iiif/manifests/${uuid}/schema.json`,
      name: "Test object",
      identifier: "test-object",
      exampleOfWork: { "@type": "CreativeWork", name: "Object" },
      height: { "@type": "QuantitativeValue" },
      width: { "@type": "QuantitativeValue" },
      depth: { "@type": "QuantitativeValue" },
      citation: [
        { "@type": "CreativeWork", name: "Field notes" },
        {
          "@type": "CreativeWork",
          name: "Catalogue <first edition> & notes",
          sameAs: "https://example.test/catalogue",
        },
        { "@type": "CreativeWork", name: "Printed catalogue", sameAs: "urn:isbn:0451450523" },
      ],
    };

    expect(createManifest([], metadata, uuid)).toMatchObject({
      metadata: expect.arrayContaining([
        {
          label: { en: ["Documentation"], nl: ["Documentatie"] },
          value: {
            nl: [
              "Field notes",
              '<span><a href="https://example.test/catalogue">Catalogue &lt;first edition&gt; &amp; notes</a></span>',
              "Printed catalogue",
            ],
          },
        },
      ]),
    });
  });

  test("does not copy schema collection membership into partOf", () => {
    const uuid = "11111111-1111-4111-8111-111111111111";
    const metadata: SchemaMetadata = {
      "@context": "https://schema.org",
      "@type": "CreativeWork",
      "@id": `https://heritage.tudelft.nl/iiif/manifests/${uuid}/schema.json`,
      name: "Test object",
      identifier: "test-object",
      exampleOfWork: {
        "@type": "CreativeWork",
        name: "Object",
      },
      height: { "@type": "QuantitativeValue" },
      width: { "@type": "QuantitativeValue" },
      depth: { "@type": "QuantitativeValue" },
      isPartOf: [
        {
          "@id": "https://example.org/collections/public.json",
          "@type": "Collection",
        },
      ],
    };

    const manifest = createManifest([], metadata, uuid) as Record<
      string,
      unknown
    >;

    expect(manifest.partOf).toBeUndefined();
  });
});
