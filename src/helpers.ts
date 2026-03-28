import { OAIBaseUrl, types } from "./settings";

export function getUuid(id: string) {
  return id.match(/manifests\/(.+?)\/schema.json/)?.[1];
}

export function getValueAsArray(prop: object | Array<object>) {
  return Array.isArray(prop) ? prop : new Array(prop);
}

export function getUrlForObject(identifier: string, type: string = "objects") {
  const url = new URL(OAIBaseUrl + types[type] + "/request");
  const searchParams = url.searchParams;
  searchParams.append("verb", "GetRecord");
  searchParams.append("identifier", identifier);
  searchParams.append("metadataPrefix", "rdf");
  return url.toString();
}
