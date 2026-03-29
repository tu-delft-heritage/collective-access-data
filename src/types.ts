import * as z from "zod";

const SchemaImageObject = z.preprocess(
  (val: any) => ({
    "@type": "ImageObject",
    ...val.ImageObject,
  }),
  z.object({
    "@type": z.literal("ImageObject"),
    contentUrl: z.object({
      "@context": z.url(),
      "@id": z.url(),
      "@type": z.literal("Image"),
    }),
    thumbnailUrl: z.url(),
    encodingFormat: z.literal("https://iiif.io/api/image/3.0/"),
    caption: z.string().optional(),
    width: z.coerce.number(),
    height: z.coerce.number(),
    position: z.coerce.number(),
  }),
);

const SchemaQuantitativeValue = z.object({
  "@type": z.literal("QuantativeValue"),
  unitCode: z.string(),
  value: z.coerce.number().optional(),
});

const preprocessSameAs = (val: any) => {
  const sameAsVal = val.sameAs?.resource;
  if (sameAsVal) {
    val.sameAs = sameAsVal;
  } else if (val.sameAs) {
    delete val.sameAs;
  }
};

const SchemaPlace = z.preprocess(
  (val: any) => {
    preprocessSameAs(val.Place);
    return {
      "@type": "Place",
      ...val.Place,
    };
  },
  z.object({
    "@type": z.literal("Place"),
    address: z.string(),
    latitude: z.coerce.number(),
    longitude: z.coerce.number(),
    sameAs: z.url().optional(),
  }),
);

export type SchemaEntity = z.infer<typeof SchemaEntity>;

const SchemaEntity = z.preprocess(
  (val: any) => {
    const type = Object.keys(val).shift() as string;
    preprocessSameAs(val[type]);
    return {
      "@type": type,
      ...val[type],
    };
  },
  z.object({
    "@type": z.string(),
    name: z.string(),
    sameAs: z.url().optional(),
    identifier: z.string().optional(),
    // image: SchemaImageObject.optional(),
  }),
);

const SchemaRoleContributor = z.preprocess(
  (val: any) => ({
    "@type": "Role",
    roleName: val.Role.roleName,
    contributor: val.Role.Contributor,
  }),
  z.object({
    "@type": z.literal("Role"),
    roleName: z.string(),
    contributor: SchemaEntity,
  }),
);

const SchemaRoleCreator = z.preprocess(
  (val: any) => ({
    "@type": "Role",
    roleName: val.Role?.roleName,
    creator: val.Role?.Creator,
  }),
  z.object({
    "@type": z.literal("Role"),
    roleName: z.string(),
    creator: SchemaEntity,
  }),
);

export type SchemaMetadata = z.infer<typeof SchemaMetadata>;

export const SchemaMetadata = z.preprocess(
  (val: any) => ({
    "@context": "https://schema.org",
    "@type": "CreativeWork",
    ...val,
  }),
  z.object({
    "@context": z.literal("https://schema.org"),
    "@type": z.literal("CreativeWork"),
    "@id": z.url(),
    name: z.string(),
    description: z.string().optional(),
    identifier: z.string(),
    temporalCoverage: z.string().optional(),
    exampleOfWork: SchemaEntity,
    material: z.array(SchemaEntity).or(SchemaEntity).optional(),
    creator: z.array(SchemaRoleCreator).or(SchemaRoleCreator).optional(),
    contributor: z
      .array(SchemaRoleContributor)
      .or(SchemaRoleContributor)
      .optional(),
    about: SchemaEntity.optional(),
    locationCreated: SchemaPlace.optional(),
    height: SchemaQuantitativeValue,
    width: SchemaQuantitativeValue,
    depth: SchemaQuantitativeValue,
    citation: z
      .preprocess((val) => {
        if (Array.isArray(val)) {
          return val.filter(Boolean);
        } else {
          return val;
        }
      }, z.array(z.string()).or(z.string()))
      .optional(),
    isRelatedTo: SchemaEntity.or(z.array(SchemaEntity)).optional(),
    image: z
      .array(SchemaImageObject)
      .or(SchemaImageObject)
      .transform((val) => {
        if (Array.isArray(val)) {
          return val.sort((a, b) => {
            return a.position - b.position;
          });
        } else return val;
      })
      .optional(),
  }),
);

export type SchemaCollectionMetadata = z.infer<typeof SchemaCollectionMetadata>;

export const SchemaCollectionMetadata = z.preprocess(
  (val: any) => ({
    "@context": "https://schema.org",
    "@type": "CreativeWork",
    ...val,
  }),
  z.object({
    "@id": z.url(),
    name: z.string(),
    description: z.string(),
    identifier: z.string(),
    creator: z.array(SchemaRoleCreator).or(SchemaRoleCreator).optional(),
    contributor: z
      .array(SchemaRoleContributor)
      .or(SchemaRoleContributor)
      .optional(),
    hasPart: z.array(SchemaEntity).or(SchemaEntity).optional(),
  }),
);

type SchemaMetadataByKind = {
  object: z.input<typeof SchemaMetadata>;
  collection: z.input<typeof SchemaCollectionMetadata>;
};

export type SchemaRecord<K extends keyof SchemaMetadataByKind> = {
  header: {
    identifier: string;
    datestamp: string;
  };
  metadata: {
    RDF: {
      schema: string;
      rdf: string;
      CreativeWork: SchemaMetadataByKind[K];
    };
  };
};

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
