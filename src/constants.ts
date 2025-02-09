import type { Vocabulary } from "./types";

export const outputDir = "output/collective-access/";
export const cacheDir = ".cache/";
export const OAIBaseUrl =
  "https://cms.collectiveaccess.tudelft.nl/service.php/OAI/";
export const dlcsImageBase = "https://dlc.services/iiif-img/v3/7/";
export const dlcsSpace = "18";
export const manifestUriBase =
  "http://localhost:5500/output/collective-access/";

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

export const labels = {
  "dc:title": {
    en: ["Title"],
    nl: ["Titel"],
  },
  "dc:type": {
    en: ["Object name"],
    nl: ["Objectnaam"],
  },
  "dc:identifier": {
    en: ["Inventory number"],
    nl: ["Inventarisnummer"],
  },
  "dc:date": {
    en: ["Dating"],
    nl: ["Datering"],
  },
  "dc:contributor": {
    en: ["Maker"],
    nl: ["Maker"],
  },
  "dc:creator": {
    en: ["Maker"],
    nl: ["Maker"],
  },
  "dc:format": {
    en: ["Dimensions"],
    nl: ["Afmetingen"],
  },
  "dc:medium": {
    en: ["Material"],
    nl: ["Materiaal"],
  },
  "dc:coverage": {
    en: ["Place of manufacture"],
    nl: ["Plaats vervaardiging"],
  },
  "dc:description": {
    en: ["Description"],
    nl: ["Beschrijving"],
  },
  "dc:provenance": {
    en: ["Provenance"],
    nl: ["Herkomst"],
  },
  "dc:subject": {
    en: ["Subject"],
    nl: ["Voorstelling"],
  },
  "dc:bibliographicCitation": {
    en: ["Documentation"],
    nl: ["Documentatie"],
  },
  "dc:relation": {
    en: ["Related object"],
    nl: ["Gerelateerd object"],
  },
};
