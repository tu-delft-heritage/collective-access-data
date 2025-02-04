import type { Vocabulary } from "./types";

export const outputDir = "output/collective-access/";
export const cacheDir = ".cache/";
export const OAIBaseUrl =
  "https://cms.collectiveaccess.tudelft.nl/service.php/OAI/";
export const dlcsImageBase = "https://dlc.services/iiif-img/v3/7/";
export const dlcsSpace = "18";
export const manifestUriBase =
  "http://127.0.0.1:5500/output/collective-access/";

export const types: Vocabulary = {
  objects: "dc_obj_erfgoed",
  collections: "dc_collection",
};

export const verbs = [
  "Identify",
  "ListMetadataFormats",
  "ListSets",
  "ListIdentifiers",
  "ListRecords",
  "GetRecord",
];
