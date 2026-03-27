export function getUuid(id: string) {
  return id.match(/manifests\/(.+?)\/schema.json/)?.[1];
}

function getValueAsArray(prop: object | Array<object>) {
  return Array.isArray(prop) ? prop : new Array(prop);
}
