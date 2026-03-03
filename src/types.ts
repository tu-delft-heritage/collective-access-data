export interface Vocabulary {
  [key: string]: string;
}

type OneOrMany<T> = T | T[];

type SchemaMetadataByKind = {
  object: SchemaObjectMetadata;
  collection: SchemaCollectionMetadata;
};

export type SchemaRecord<K extends keyof SchemaMetadataByKind> = {
  header: {
    identifier: string;
    datestamp: string;
  };
  metadata: {
    "rdf:RDF": {
      "xmlns:schema": string;
      "xmlns:rdf": string;
      "schema:CreativeWork": SchemaMetadataByKind[K];
    };
  };
};

export interface SchemaSameAs {
  "rdf:resource": string;
}

export interface SchemaPerson {
  "schema:Person": {
    "schema:name": string;
    "schema:sameAs"?: SchemaSameAs;
  };
}

export interface SchemaOrganization {
  "schema:Organization": {
    "schema:name": string;
    "schema:sameAs"?: SchemaSameAs;
  };
}

export interface SchemaCreativeWork {
  "schema:CreativeWork": {
    "schema:name": string;
    "schema:sameAs": SchemaSameAs;
    "schema:identifier"?: string;
    "schema:image"?: Partial<SchemaImageObject>;
  };
}

export interface SchemaProduct {
  "schema:Product": {
    "schema:name": string;
    "schema:sameAs": SchemaSameAs;
    "schema:identifier"?: string;
  };
}

type SchemaRoleKind = "Creator" | "Contributor";

type SchemaRole<K extends SchemaRoleKind> = {
  // Should be roleName!
  "schema:RoleName": string;
} & {
  [P in `schema:${K}`]: SchemaPerson | SchemaOrganization;
};

export interface SchemaQuantitativeValue {
  "rdf:type": string;
  "schema:unitCode": string;
  "schema:value": string;
}

export interface SchemaImageObject {
  "schema:ImageObject": {
    "schema:contentUrl": {
      "rdf:context": string;
      "rdf:id": string;
      "rdf:type": string;
    };
    "schema:thumbnailUrl": string;
    "schema:encodingFormat": string;
    "schema:caption": string;
    "schema:width": string;
    "schema:height": string;
    "schema:position": string;
  };
}

export interface SchemaPlace {
  "schema:address": string;
  "schema:latitude": string;
  "schema:longitude": string;
  "schema:sameAs": SchemaSameAs;
}

export interface SchemaObjectMetadata {
  "rdf:id": string;
  "schema:name": string;
  "schema:description": string;
  "schema:identifier": string;
  "schema:temporalCoverage": string;
  "schema:exampleOfWork": OneOrMany<SchemaCreativeWork>;
  "schema:material": OneOrMany<SchemaProduct>;
  "schema:creator": OneOrMany<SchemaRole<"Creator">>;
  "schema:contributor": OneOrMany<SchemaRole<"Contributor">>;
  "schema:about": SchemaPerson;
  "schema:locationCreated": SchemaPlace;
  "schema:height": SchemaQuantitativeValue;
  "schema:width": SchemaQuantitativeValue;
  "schema:depth": SchemaQuantitativeValue;
  "schema:citation": string;
  "schema:isRelatedTo": OneOrMany<SchemaProduct>;
  "schema:image": OneOrMany<SchemaImageObject>;
}

export interface SchemaCollectionMetadata {
  "rdf:id": string;
  "schema:name": string;
  "schema:description": string;
  "schema:identifier": string;
  "schema:creator": OneOrMany<SchemaRole<"Creator">>;
  "schema:contributor": OneOrMany<SchemaRole<"Contributor">>;
  "schema:hasPart": OneOrMany<SchemaCreativeWork>;
}

export interface DublinCoreRecord {
  header: {
    identifier: string[];
    datestamp: string[];
  }[];
  metadata: {
    "qdc:dc": DublinCoreMetadata[];
  }[];
}

export interface DublinCoreMetadata {
  [index: string]: string[] | undefined | DublinCoreImage[] | DublinCorePart[];
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
  "dc:image"?: DublinCoreImage[];
  "dc:subject"?: string[];
  "dc:provenance"?: string[];
  "dc:hasPart"?: DublinCorePart[];
}

export interface DublinCoreImage {
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

export interface DublinCorePart {
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
    },
  ];
  extraQualities: string[];
  extraFormats: string[];
  extraFeatures: string[];
};
