export interface Vocabulary {
  [key: string]: string;
}

export interface Record {
  header: {
    identifier: string[];
    datestamp: string[];
  }[];
  metadata: {
    "qdc:dc": Metadata[];
  }[];
}

export interface Metadata {
  [index: string]: string[] | undefined | Image[] | Part[];
  "dc:isVersionOf": string[];
  "dc:title": string[];
  "dc:type"?: string[];
  "dc:identifier": string[];
  "dc:date"?: string[];
  "dc:language": string[];
  "dc:accessRights": string[];
  "dc:contributor"?: string[];
  "dc:creator"?: string[];
  "dc:format"?: string[];
  "dc:medium"?: string[];
  "dc:coverage"?: string[];
  "dc:description": string[];
  "dc:bibliographicCitation"?: string[];
  "dc:relation"?: string[];
  "dc:image"?: Image[];
  "dc:subject"?: string[];
  "dc:provenance"?: string[];
  "dc:hasPart"?: Part[];
}

export interface Image {
  "dc:isVersionOf": string[];
  "dc:identifier": string[];
  "dc:accessRights"?: string[];
  "dc:tableOfContents": string[];
  "dc:hasVersion": string[];
}

export interface ImageImproved {
  uuid: string;
  name: string;
  sort: number;
  access: string | undefined;
}

export interface Part {
  "dc:isVersionOf": string[];
  "dc:type": string[];
  "dc:source": string[];
  "dc:identifier": string[];
  "dc:accessRights": string[];
  "dc:hasVersion": string[];
}

export type IIIFImageInformation = {
  "@context": string;
  id: string;
  type: string;
  profile: string;
  protocol: string;
  width: number;
  height: number;
  maxArea: number;
  sizes: [{ width: number; height: number }];
  tiles: [
    {
      width: number;
      height: number;
      scaleFactors: number[];
    }
  ];
  extraQualities: string[];
  extraFormats: string[];
  extraFeatures: string[];
};
