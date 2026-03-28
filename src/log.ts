export const date = new Date().toISOString().slice(0, -5).replaceAll(":", ".");
const log = Bun.file(`logs/${date}.txt`);
export const writer = log.writer();
