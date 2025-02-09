import { Parser } from "xml2js";
import {
  OAIBaseUrl,
  types,
  cacheDir,
  dlcsImageBase,
  dlcsSpace,
} from "./settings";

async function fetchXML(
  type: string = "objects",
  resumptionToken: undefined | string = undefined,
  verb = "ListRecords",
  identifier: undefined | string = undefined
) {
  const url = new URL(OAIBaseUrl + types[type] + "/request");

  // Set query strings
  const searchParams = url.searchParams;
  searchParams.append("verb", verb);

  if (identifier) {
    searchParams.append("identifier", identifier);
  }

  // metadataPrefix param is not accepted in combination with token
  if (resumptionToken) {
    searchParams.append("resumptionToken", resumptionToken);
  } else {
    searchParams.append("metadataPrefix", "qdc");
  }

  // Fetch data and parse XML
  const parser = new Parser();
  return fetch(url.toString())
    .then((response) => response.text())
    .then((text) => parser.parseStringPromise(text))
    .catch((err) => {
      throw new Error(err);
    });
}

function getResumptionToken(resp: any) {
  const tokenObj = resp?.["OAI-PMH"]?.ListRecords?.[0]?.resumptionToken?.[0];
  const count: string | undefined = tokenObj?.$?.completeListSize;
  const resumptionToken: string | undefined = tokenObj?._;
  return [resumptionToken, count];
}

function getRecords(resp: any) {
  return resp?.["OAI-PMH"]?.ListRecords?.[0]?.record;
}

export async function fetchRecords(
  type: string = "objects",
  useCache: boolean = true
) {
  // Get cache
  const cache = Bun.file(cacheDir + "collective-access/" + type + ".json");
  if (useCache && (await cache.exists())) {
    console.log(`Using cache`);
    return await cache.json();
  }

  // Fetch first page
  console.log(`Loading ${type}...`);
  const resp = await fetchXML(type);

  // Push results to records array
  const records = getRecords(resp);

  // Check for resumption token
  let [token, count] = getResumptionToken(resp);

  // Fetch additional records if needed
  if (token && count) {
    let index = 0;
    let pageCount = Math.ceil(+count / 100);
    console.log(`Multiple pages found...`);

    while (index < pageCount) {
      console.log(`Loading page ${index + 1}/${pageCount}...`);
      const nextResp = await fetchXML(type, token);
      records.push(...getRecords(nextResp));
      [token] = getResumptionToken(nextResp);
      index++;
    }
  }

  // Write cache
  Bun.write(
    `${cacheDir + "collective-access/" + type}.json`,
    JSON.stringify(records, null, 2)
  );
  console.log(`${records.length} ${type} fetched`);
  return records;
}

async function getCache(id: string, type: string) {
  const file = Bun.file(`${cacheDir + type}/${id}.json`);
  if (await file.exists()) {
    return file.json();
  } else return null;
}

export async function fetchImageInformationWithCache(
  uuid: string,
  useCache: boolean = true
) {
  if (useCache) {
    const cache = await getCache(uuid, "dlcs");
    if (cache) {
      return cache;
    }
  }
  const url = dlcsImageBase + dlcsSpace + "/" + uuid;
  const resp = await fetch(url).then((resp) => resp.json());
  if (resp?.status === 404) {
    throw new Error(`Fetch failed for ${uuid}`);
  }
  await saveJson(resp, uuid, cacheDir + "dlcs/");
  return resp;
}

export function saveJson(json: any, filename: string, path: string) {
  return Bun.write(`${path}/${filename}.json`, JSON.stringify(json, null, 4));
}
