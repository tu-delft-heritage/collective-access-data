import he from "he";
import type {
  SchemaRecord,
  SchemaCreativeWork,
  SchemaObjectMetadata,
} from "./types";

export function getUuid(id: string) {
  return id.match(/manifests\/(.+?)\/schema.json/)?.[1];
}

function removePrefixes(props: Record<string, any>) {
  const objArr = Object.entries(props);
  const modifiedArr = objArr.map(([key, value]) => {
    key = key.split(":")[1];
    return [key, value];
  });
  return Object.fromEntries(modifiedArr);
}

function normalizeProps(prop: SchemaCreativeWork) {
  let [type, props] = Object.entries(prop)[0];
  props = removePrefixes(props);
  type = type.split(":")[1];
  if (props.sameAs) {
    props.sameAs = props.sameAs["rdf:resource"];
  }
  if (props.Creator) {
    props.creator = normalizeProps(props.Creator);
    delete props.Creator;
  }
  if (props.Contributor) {
    props.contributor = normalizeProps(props.Contributor);
    delete props.Contributor;
  }
  if (props.contentUrl) {
    props.contentUrl = removePrefixes(props.contentUrl);
  }
  return {
    ["@type"]: type,
    ...props,
  };
}

function getValueAsArray(prop: object | Array<object>) {
  return Array.isArray(prop) ? prop : new Array(prop);
}

export function normalizeSchemaRecord(props: SchemaObjectMetadata) {
  props = removePrefixes(props);
  Object.entries(props).forEach(([key, value]) => {
    if (!value) return;
    const simpleValues = [
      "id",
      "name",
      "description",
      "identifier",
      "temporalCoverage",
      "citation",
    ];
    if (simpleValues.includes(key)) {
      if (Array.isArray(value)) {
        value = value.filter((v) => v);
        return;
      } else return;
    }
    const keysWithoutNesting = ["height", "width", "depth"];
    if (keysWithoutNesting.includes(key)) {
      props[key] = removePrefixes(value);
      return;
    }
    const valueArr = getValueAsArray(value);
    props[key] = valueArr.map(normalizeProps);
  });
  return {
    "@context": "https://schema.org",
    "@type": "CreativeWork",
    ...props,
  };
}
