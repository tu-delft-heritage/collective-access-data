import { en } from "zod/locales";
import { getValueAsArray } from "./helpers";
import type { SchemaMetadata, SchemaEntity } from "./schema";

export const outputDir = "build/iiif";
export const objectsFolder = "objects";
export const collectionsFolder = "collections";
export const cacheDir = ".cache";
export const OAIBaseUrl =
  "https://cms.collectiveaccess.tudelft.nl/service.php/OAI/";
export const dlcsImageBase = "https://dlc.services/iiif-img/v3/7/";
export const dlcsSpace = "18";
export const manifestUriBase =
  "https://tu-delft-heritage.github.io/collective-access-data/iiif/";

export const types: Record<string, string> = {
  objects: "schema_org",
  collections: "col_schema_org",
  media: "dc_media",
};

export const verbs = [
  "Identify",
  "ListMetadataFormats",
  "ListSets",
  "ListIdentifiers",
  "ListRecords",
  "GetRecord",
];

export const objectMapping = [
  {
    props: ["name"],
    label: {
      en: ["Title"],
      nl: ["Titel"],
    },
    getValue: (metadata: SchemaMetadata) => getValueAsArray(metadata.name),
  },
  {
    props: ["exampleOfWork"],
    label: {
      en: ["Object name"],
      nl: ["Objectnaam"],
    },
    getValue: (metadata: SchemaMetadata) => {
      if (metadata.exampleOfWork) {
        return getValueAsArray(metadata.exampleOfWork).map(
          (entity) => entity.name,
        );
      }
    },
  },
  {
    props: ["identifier"],
    label: {
      en: ["Inventory number"],
      nl: ["Inventarisnummer"],
    },
    getValue: (metadata: SchemaMetadata) =>
      getValueAsArray(metadata.identifier),
  },
  {
    props: ["temporalCoverage"],
    label: {
      en: ["Dating"],
      nl: ["Datering"],
    },
    getValue: (metadata: SchemaMetadata) => {
      if (metadata.temporalCoverage) {
        const period = metadata.temporalCoverage.split("/");
        if (period[1]) {
          return [period.join(" – ")];
        } else if (period) return [period[0]];
      }
    },
  },
  {
    props: ["creator", "contributor"],
    label: {
      en: ["Maker"],
      nl: ["Maker"],
    },
    getValue: (metadata: SchemaMetadata) => {
      let creators: string[] = [];
      let contributors: string[] = [];
      if (metadata.creator) {
        creators = getValueAsArray(metadata.creator).map((role) => {
          const roleName = role.roleName;
          const name = role.creator.name;
          return `${name} (${roleName})`;
        });
      }
      if (metadata.contributor) {
        contributors = getValueAsArray(metadata.contributor)
          .map((role) => {
            const roleName = role.roleName;
            const name = role.contributor.name;
            if (roleName !== "had in bezit") {
              return `${name} (${roleName})`;
            }
          })
          .filter(Boolean) as string[];
      }
      const makers = creators.concat(contributors);
      if (makers.length) return makers;
    },
  },
  {
    props: ["height, width, depth"],
    label: {
      en: ["Dimensions"],
      nl: ["Afmetingen"],
    },
    getValue: (metadata: SchemaMetadata) => {
      const dimensions = [];
      const units = {
        MMT: "mm",
        CMT: "cm",
        MTR: "m",
      };
      if (metadata.height?.value && metadata.height.unitCode) {
        const unit = units[metadata.height.unitCode];
        dimensions.push(`${metadata.height.value} ${unit} (h)`);
      }
      if (metadata.width?.value && metadata.width.unitCode) {
        const unit = units[metadata.width.unitCode];
        dimensions.push(`${metadata.width.value} ${unit} (b)`);
      }

      if (metadata.depth?.value && metadata.depth.unitCode) {
        const unit = units[metadata.depth.unitCode];
        dimensions.push(`${metadata.depth.value} ${unit} (d)`);
      }
      if (dimensions.length) {
        return [dimensions.join(" x ")];
      }
    },
  },
  {
    props: ["material"],
    label: {
      en: ["Material"],
      nl: ["Materiaal"],
    },
    getValue: (metadata: SchemaMetadata) => {
      if (metadata.material) {
        return getValueAsArray(metadata.material).map(
          (material) => material.name,
        );
      }
    },
  },
  {
    props: ["locationCreated"],
    label: {
      en: ["Place of manufacture"],
      nl: ["Plaats vervaardiging"],
    },
    getValue: (metadata: SchemaMetadata) => {
      if (metadata.locationCreated) {
        return getValueAsArray(metadata.locationCreated.address);
      }
    },
  },
  {
    props: ["description"],
    label: {
      en: ["Description"],
      nl: ["Beschrijving"],
    },
    getValue: (metadata: SchemaMetadata) => {
      if (metadata.description) {
        return getValueAsArray(metadata.description);
      }
    },
  },
  {
    props: ["contributor"],
    label: {
      en: ["Provenance"],
      nl: ["Herkomst"],
    },
    getValue: (metadata: SchemaMetadata) => {
      if (metadata.contributor) {
        return getValueAsArray(metadata.contributor)
          .filter((role) => role.roleName === "had in bezit")
          .map((role) => {
            const roleName = role.roleName;
            const name = role.contributor.name;
            return `${name} (${roleName})`;
          });
      }
    },
  },
  {
    props: ["about"],
    label: {
      en: ["Subject"],
      nl: ["Voorstelling"],
    },
    getValue: (metadata: SchemaMetadata) => {
      if (metadata.about) {
        return getValueAsArray(metadata.about.name);
      }
    },
  },
  {
    props: ["citation"],
    label: {
      en: ["Documentation"],
      nl: ["Documentatie"],
    },
    getValue: (metadata: SchemaMetadata) => {
      if (metadata.citation) {
        return getValueAsArray(metadata.citation);
      }
    },
  },
  {
    props: ["isRelatedTo"],
    label: {
      en: ["Related object"],
      nl: ["Gerelateerd object"],
    },
    getValue: (metadata: SchemaMetadata) => {
      if (metadata.isRelatedTo) {
        return getValueAsArray(metadata.isRelatedTo).map((entity) => {
          if (entity.identifier) {
            return `${entity.name} (${entity.identifier})`;
          } else {
            return entity.name;
          }
        });
      }
    },
  },
];

export const collectionMapping = [
  {
    props: ["creator"],
    label: {
      en: ["Managing institution"],
      nl: ["Beherende instelling"],
    },
    getValue: (metadata: SchemaMetadata) => undefined,
  },
  {
    props: ["contributor"],
    label: {
      en: ["Curator"],
      nl: ["Conservator"],
    },
    getValue: (metadata: SchemaMetadata) => undefined,
  },
];

// Hardcoded for now
export const collectionMetadata = [
  {
    label: {
      en: ["Managing institution"],
      nl: ["Beherende instelling"],
    },
    value: {
      en: ["TU Delft Library"],
    },
  },
  {
    label: {
      en: ["Curator"],
      nl: ["Conservator"],
    },
    value: {
      none: ["Sylvia Nijhuis"],
    },
  },
];
