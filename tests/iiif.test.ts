import { describe, expect, test } from "bun:test";
import { createManifest } from "../src/iiif.ts";
import type { SchemaMetadata } from "../src/schema.ts";

describe("IIIF object manifest", () => {
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
