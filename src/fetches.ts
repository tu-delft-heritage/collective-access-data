import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import { dirname, join } from "node:path";
import he from "he";
import { Parser } from "xml2js";
import {
  OAIBaseUrl,
  cacheDir,
  dlcsImageBase,
  dlcsSpace,
  types,
} from "./settings";
import type { IIIFImageInformation } from "./schema";

type Fetcher = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

export type FetchRecordsOptions = {
  cacheDirectory?: string;
  fetcher?: Fetcher;
  useCache?: boolean;
};

type FetchXmlOptions = Required<Pick<FetchRecordsOptions, "useCache">> &
  Pick<FetchRecordsOptions, "cacheDirectory" | "fetcher">;

export type FetchedRecords = {
  records: unknown[];
  usedCachedResponse: boolean;
};

export type ImageInformationFetchResult =
  | IIIFImageInformation
  | { error: string };

function decodeValue(value: string) {
  return he.decode(value).trim();
}

function removePrefix(tag: string) {
  if (!tag.includes(":")) return tag;

  const tagName = tag.split(":").pop();
  const addAtSign = ["type", "id", "context"];
  return tagName && addAtSign.includes(tagName) ? `@${tagName}` : tagName;
}

function createParser() {
  return new Parser({
    mergeAttrs: true,
    emptyTag: undefined,
    explicitArray: false,
    attrValueProcessors: [decodeValue],
    attrNameProcessors: [removePrefix],
    valueProcessors: [decodeValue],
    tagNameProcessors: [removePrefix],
  });
}

function getXmlCachePath(url: URL, directory: string) {
  const key = createHash("sha256").update(url.toString()).digest("hex");
  return join(directory, "collective-access", "xml", `${key}.xml`);
}

async function readCachedXml(path: string) {
  try {
    return await fs.readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

async function writeCachedXml(path: string, xml: string) {
  await fs.mkdir(dirname(path), { recursive: true });
  await fs.writeFile(path, xml, "utf8");
}

export async function fetchXML(
  type: string = "objects",
  resumptionToken: string | undefined = undefined,
  verb = "ListRecords",
  identifier: string | undefined = undefined,
  options: FetchXmlOptions = { useCache: true },
) {
  const set = types[type];
  if (!set) throw new Error(`Unknown CollectiveAccess record type: ${type}`);

  const url = new URL(OAIBaseUrl + set + "/request");
  url.searchParams.append("verb", verb);

  if (identifier) url.searchParams.append("identifier", identifier);

  // metadataPrefix is not accepted in combination with a resumption token.
  if (resumptionToken) {
    url.searchParams.append("resumptionToken", resumptionToken);
  } else {
    url.searchParams.append("metadataPrefix", "rdf");
  }

  const xmlCachePath = getXmlCachePath(
    url,
    options.cacheDirectory ?? cacheDir,
  );
  const cachedXml = options.useCache
    ? await readCachedXml(xmlCachePath)
    : undefined;

  let xml: string;
  if (cachedXml !== undefined) {
    xml = cachedXml;
  } else {
    const response = await (options.fetcher ?? fetch)(url);
    if (!response.ok) {
      throw new Error(
        `CollectiveAccess returned ${response.status} ${response.statusText} for ${url}`,
      );
    }
    xml = await response.text();
  }

  const data = await createParser().parseStringPromise(xml);
  if (cachedXml === undefined) await writeCachedXml(xmlCachePath, xml);
  return { data, fromCache: cachedXml !== undefined };
}

function getResumptionToken(resp: any) {
  const tokenObject = resp?.["OAI-PMH"]?.ListRecords?.resumptionToken;
  const count: string | undefined = tokenObject?.completeListSize;
  const token: string | undefined =
    typeof tokenObject === "string" ? tokenObject : tokenObject?._;
  return { count, token };
}

function getRecords(resp: any): unknown[] {
  const records = resp?.["OAI-PMH"]?.ListRecords?.record;
  if (records === undefined) {
    const error = resp?.["OAI-PMH"]?.error;
    if (error) {
      const message = typeof error === "string" ? error : error._;
      throw new Error(`CollectiveAccess OAI error: ${message ?? "unknown error"}`);
    }
    return [];
  }
  return Array.isArray(records) ? records : [records];
}

export async function fetchRecords(
  type: string = "objects",
  options: FetchRecordsOptions | boolean = {},
): Promise<FetchedRecords> {
  const normalizedOptions: FetchRecordsOptions =
    typeof options === "boolean" ? { useCache: options } : options;
  const xmlOptions: FetchXmlOptions = {
    cacheDirectory: normalizedOptions.cacheDirectory,
    fetcher: normalizedOptions.fetcher,
    useCache: normalizedOptions.useCache ?? true,
  };

  console.log(`Loading ${type}...`);
  const firstResponse = await fetchXML(
    type,
    undefined,
    "ListRecords",
    undefined,
    xmlOptions,
  );
  const records = getRecords(firstResponse.data);
  let usedCachedResponse = firstResponse.fromCache;
  let { count, token } = getResumptionToken(firstResponse.data);

  if (token) {
    console.log(`Multiple pages found (${count ?? "unknown"} records)...`);
  }

  const seenTokens = new Set<string>();
  let page = 2;
  while (token) {
    if (seenTokens.has(token)) {
      throw new Error(`CollectiveAccess repeated a resumption token on page ${page}`);
    }
    seenTokens.add(token);
    console.log(`Loading ${type} page ${page}...`);
    const nextResponse = await fetchXML(
      type,
      token,
      "ListRecords",
      undefined,
      xmlOptions,
    );
    records.push(...getRecords(nextResponse.data));
    usedCachedResponse ||= nextResponse.fromCache;
    ({ count, token } = getResumptionToken(nextResponse.data));
    page++;
  }

  console.log(`${records.length} ${type} fetched`);
  return { records, usedCachedResponse };
}

async function getCache(id: string, type: string) {
  const file = Bun.file(join(cacheDir, type, `${id}.json`));
  if (await file.exists()) return file.json();
  return null;
}

export async function fetchImageInformationWithCache(
  uuid: string,
  useCache: boolean = true,
): Promise<ImageInformationFetchResult> {
  if (useCache) {
    const cached = await getCache(uuid, "dlcs");
    if (cached) return cached;
  }

  const url = `${dlcsImageBase}${dlcsSpace}/${uuid}`;
  const response = await fetch(url);
  if (!response.ok) return { error: uuid };
  const json = await response.json();
  await saveJson(json, uuid, join(cacheDir, "dlcs"));
  return json;
}

export function saveJson(json: unknown, filename: string, path: string) {
  return Bun.write(
    join(path, `${filename}.json`),
    JSON.stringify(json, null, 4),
  );
}
