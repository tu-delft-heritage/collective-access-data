import { OAIBaseUrl, types } from "./settings";

export function getUuid(id: string) {
  if (id.startsWith("https://heritage.tudelft.nl")) {
    return id.match(/manifests\/(.+?)\/schema.json/)?.[1];
  } else if (id.startsWith("https://dlc.services")) {
    return id.match(/iiif-img\/7\/18\/(.+)/)?.[1];
  }
}

export function getValueAsArray<T>(prop: T | T[] | undefined): T[] {
  return Array.isArray(prop) ? prop : prop === undefined ? [] : [prop];
}

export function getUrlForObject(identifier: string, type: string = "objects") {
  const url = new URL(OAIBaseUrl + types[type] + "/request");
  const searchParams = url.searchParams;
  searchParams.append("verb", "GetRecord");
  searchParams.append("identifier", identifier);
  searchParams.append("metadataPrefix", "rdf");
  return url.toString();
}
