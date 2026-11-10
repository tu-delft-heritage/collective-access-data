import { afterEach, describe, expect, test } from "bun:test";
import fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fetchRecords, getRecordsSnapshotPath } from "../src/fetches.ts";
import { getRecordLogContext } from "../src/generate.ts";

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
    const snapshotPath = join(
      directory,
      "collective-access",
      "objects.json",
    );
    expect(JSON.parse(await fs.readFile(snapshotPath, "utf8"))).toEqual(
      first.records,
    );
    await fs.writeFile(snapshotPath, "[]", "utf8");

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
    expect(JSON.parse(await fs.readFile(snapshotPath, "utf8"))).toEqual(
      second.records,
    );
    const cachedFiles = await fs.readdir(
      join(directory, "collective-access", "xml"),
    );
    expect(cachedFiles).toHaveLength(1);
    expect(cachedFiles[0]).toEndWith(".xml");

    const refreshed = await fetchRecords("objects", {
      cacheDirectory: directory,
      fetcher: async () => {
        fetchCount++;
        return new Response(xml.replace("oai:test:1", "oai:test:2"));
      },
      useCache: false,
    });
    expect(refreshed.usedCachedResponse).toBe(false);
    expect(refreshed.records).not.toEqual(first.records);
    expect(fetchCount).toBe(2);
    expect(JSON.parse(await fs.readFile(snapshotPath, "utf8"))).toEqual(
      refreshed.records,
    );
  });

  test.each([
    { xml: "<html>Service unavailable</html>", error: "missing ListRecords" },
    { xml: "<OAI-PMH><ListRecords>Service unavailable</ListRecords></OAI-PMH>", error: "missing records" },
  ])("rejects malformed exports: $error", async ({ xml, error }) => {
    const directory = await fs.mkdtemp(join(tmpdir(), "collective-access-data-"));
    temporaryDirectories.push(directory);

    await expect(fetchRecords("objects", {
      cacheDirectory: directory,
      fetcher: async () => new Response(xml),
      useCache: false,
    })).rejects.toThrow(error);
    expect(await Bun.file(join(directory, "collective-access", "objects.json")).exists()).toBe(false);
  });

  test("uses the alternate OAI base URL for every page and keeps sources separate", async () => {
    const directory = await fs.mkdtemp(join(tmpdir(), "collective-access-data-"));
    temporaryDirectories.push(directory);
    const oaiBaseUrl = "https://example.test/staging/service.php/OAI";
    const requests: URL[] = [];
    const fetcher = async (url: string | URL | Request) => {
      if (!(url instanceof URL)) throw new Error("Expected a URL");
      requests.push(url);
      const alternate = url.hostname === "example.test";
      const nextPage = url.searchParams.has("resumptionToken");
      const identifier = alternate ? `oai:test:${nextPage ? 3 : 2}` : "oai:test:1";
      return new Response(`<OAI-PMH><ListRecords>
        <record><header><identifier>${identifier}</identifier></header></record>
        ${alternate && !nextPage ? "<resumptionToken>next</resumptionToken>" : ""}
      </ListRecords></OAI-PMH>`);
    };
    const options = { cacheDirectory: directory, fetcher };

    const original = await fetchRecords("collections", options);
    const alternate = await fetchRecords("collections", { ...options, oaiBaseUrl });
    const cached = await fetchRecords("collections", { ...options, oaiBaseUrl: `${oaiBaseUrl}/` });

    expect(requests.slice(1).map(String)).toEqual([
      `${oaiBaseUrl}/col_schema_org/request?verb=ListRecords&metadataPrefix=rdf`,
      `${oaiBaseUrl}/col_schema_org/request?verb=ListRecords&resumptionToken=next`,
    ]);
    expect(alternate.usedCachedResponse).toBe(false);
    expect(cached).toEqual({ records: alternate.records, usedCachedResponse: true });
    expect(await Bun.file(getRecordsSnapshotPath("collections", directory)).json()).toEqual(original.records);
    expect(await Bun.file(getRecordsSnapshotPath("collections", directory, oaiBaseUrl)).json()).toEqual(alternate.records);
    expect(getRecordLogContext(alternate.records[0], "collections", oaiBaseUrl).oaiUrl).toBe(
      `${oaiBaseUrl}/col_schema_org/request?verb=GetRecord&identifier=oai%3Atest%3A2&metadataPrefix=rdf`,
    );
  });

  test("accepts an explicit noRecordsMatch response as an empty public export", async () => {
    const directory = await fs.mkdtemp(join(tmpdir(), "collective-access-data-"));
    temporaryDirectories.push(directory);

    const response = await fetchRecords("objects", {
      cacheDirectory: directory,
      fetcher: async () => new Response(
        '<OAI-PMH><error code="noRecordsMatch">No matching records</error></OAI-PMH>',
      ),
      useCache: false,
    });

    expect(response.records).toEqual([]);
    expect(response.usedCachedResponse).toBe(false);
  });
});
