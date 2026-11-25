import { expect, test } from "bun:test";
import { SchemaMetadata } from "../src/schema.ts";

function objectWithCitation(citation: unknown) {
  return {
    "@id": "https://example.org/object",
    name: "Test object",
    identifier: "test-object",
    exampleOfWork: { CreativeWork: { name: "Object" } },
    height: { "@type": "QuantitativeValue" },
    width: { "@type": "QuantitativeValue" },
    depth: { "@type": "QuantitativeValue" },
    citation,
  };
}

test("omits empty citations from both parsed XML and JSON snapshots", () => {
  const xmlCitation = { CreativeWork: { sameAs: undefined } };
  const snapshotCitation = { CreativeWork: {} };
  for (const citation of [xmlCitation, snapshotCitation, undefined, [xmlCitation, null]]) {
    expect(SchemaMetadata.parse(objectWithCitation(citation)).citation).toBeUndefined();
  }
});

test("preserves citation text, links and order alongside empty entries", () => {
  const url = "https://example.org/publication";
  const citation = () => ({ CreativeWork: { name: "Catalogue", sameAs: { resource: url } } });
  const text = { "@type": "CreativeWork", name: "Field notes" };
  const linked = { "@type": "CreativeWork", name: "Catalogue", sameAs: url };
  expect(SchemaMetadata.parse(objectWithCitation("Field notes")).citation).toEqual(text);
  expect(SchemaMetadata.parse(objectWithCitation(citation())).citation).toEqual(linked);
  const mixed = ["Field notes", { CreativeWork: {} }, undefined, citation()];
  expect(SchemaMetadata.parse(objectWithCitation(mixed)).citation).toEqual([text, linked]);
});

test("reports populated citations that lack a required name", () => {
  const citation = { CreativeWork: { sameAs: { resource: "https://example.org/publication" } } };
  expect(SchemaMetadata.safeParse(objectWithCitation(citation)).success).toBe(false);
});
