import fs from "node:fs/promises";
import { join } from "node:path";
import { json2csv } from "json-2-csv";
import { OAIBaseUrl, types } from "./settings";

export function getUuid(id: string) {
  if (id.startsWith("https://heritage.tudelft.nl")) {
    return id.match(/(manifests|collections)\/(.+?)\/schema.json/)?.[2];
  } else if (id.startsWith("https://dlc.services")) {
    return id.match(/iiif-img\/7\/18\/(.+)/)?.[1];
  }
}

export function getValueAsArray<T>(prop: T | T[] | undefined): T[] {
  return Array.isArray(prop) ? prop : prop === undefined ? [] : [prop];
}

export function normalizeOaiBaseUrl(value = OAIBaseUrl) {
  const url = URL.canParse(value) ? new URL(value) : undefined;
  if (
    !url ||
    (url.protocol !== "https:" && url.protocol !== "http:") ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    throw new Error(
      "OAI base URL must be an absolute HTTP(S) URL without credentials, a query, or a fragment.",
    );
  }
  url.pathname = `${url.pathname.replace(/\/+$/, "")}/`;
  return url.toString();
}

export function getOaiRequestUrl(type: string, oaiBaseUrl?: string) {
  if (!Object.hasOwn(types, type)) {
    throw new Error(`Unknown CollectiveAccess record type: ${type}`);
  }
  return new URL(`${types[type]}/request`, normalizeOaiBaseUrl(oaiBaseUrl));
}

export function getOaiUrl(
  identifier: string,
  type: string = "objects",
  oaiBaseUrl?: string,
) {
  const url = getOaiRequestUrl(type, oaiBaseUrl);
  const searchParams = url.searchParams;
  searchParams.append("verb", "GetRecord");
  searchParams.append("identifier", identifier);
  searchParams.append("metadataPrefix", "rdf");
  return url.toString();
}

export const date = new Date().toISOString().slice(0, -5).replaceAll(":", ".");

export async function writeCsvLog(
  rows: object[],
  keys: string[],
  directory = "logs",
) {
  await fs.mkdir(directory, { recursive: true });
  const path = join(directory, `${date}.csv`);
  const csv = json2csv(rows, {
    emptyFieldValue: "",
    keys,
    preventCsvInjection: true,
  });
  await Bun.write(path, csv.endsWith("\n") ? csv : `${csv}\n`);
  return path;
}
