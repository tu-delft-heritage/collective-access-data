import fs from "node:fs/promises";
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

export function getOaiUrl(identifier: string, type: string = "objects") {
  const url = new URL(OAIBaseUrl + types[type] + "/request");
  const searchParams = url.searchParams;
  searchParams.append("verb", "GetRecord");
  searchParams.append("identifier", identifier);
  searchParams.append("metadataPrefix", "rdf");
  return url.toString();
}

export const date = new Date().toISOString().slice(0, -5).replaceAll(":", ".");

export const createWriter = async () => {
  const dirExists = await fs.exists("logs");
  if (!dirExists) {
    await fs.mkdir("logs");
  }
  const log = Bun.file(`logs/${date}.txt`);
  return log.writer();
};
