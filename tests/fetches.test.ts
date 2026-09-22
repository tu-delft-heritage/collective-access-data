import { afterEach, describe, expect, test } from "bun:test";
import fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fetchRecords } from "../src/fetches.ts";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      fs.rm(directory, { force: true, recursive: true }),
    ),
  );
});

describe("OAI XML cache", () => {
  test("caches and reparses the raw XML response", async () => {
    const directory = await fs.mkdtemp(join(tmpdir(), "collective-access-data-"));
    temporaryDirectories.push(directory);
    let fetchCount = 0;
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
      <OAI-PMH xmlns="http://www.openarchives.org/OAI/2.0/">
        <ListRecords>
          <record>
            <header>
              <identifier>oai:test:1</identifier>
              <datestamp>2026-09-22T00:00:00Z</datestamp>
            </header>
            <metadata>
              <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
                <schema:CreativeWork xmlns:schema="https://schema.org/" rdf:about="test" />
              </rdf:RDF>
            </metadata>
          </record>
        </ListRecords>
      </OAI-PMH>`;
    const fetcher = async () => {
      fetchCount++;
      return new Response(xml, { status: 200 });
    };

    const first = await fetchRecords("objects", {
      cacheDirectory: directory,
      fetcher,
      useCache: true,
    });
    const second = await fetchRecords("objects", {
      cacheDirectory: directory,
      fetcher,
      useCache: true,
    });

    expect(first.records).toHaveLength(1);
    expect(first.usedCachedResponse).toBe(false);
    expect(second.records).toEqual(first.records);
    expect(second.usedCachedResponse).toBe(true);
    expect(fetchCount).toBe(1);
    const cachedFiles = await fs.readdir(
      join(directory, "collective-access", "xml"),
    );
    expect(cachedFiles).toHaveLength(1);
    expect(cachedFiles[0]).toEndWith(".xml");
  });
});
