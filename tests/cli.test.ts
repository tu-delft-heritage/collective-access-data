import { describe, expect, test } from "bun:test";
import { createProgram } from "../index.ts";
import { resolveGenerateOptions } from "../src/generate.ts";

describe("generation CLI options", () => {
  test.each([
    { flags: [], collectiveAccessCache: true, dlcsCache: true, delete: true },
    { flags: ["--no-collective-access-cache"], collectiveAccessCache: false, dlcsCache: true, delete: true },
    { flags: ["--no-dlcs-cache"], collectiveAccessCache: true, dlcsCache: false, delete: true },
    { flags: ["--no-cache"], collectiveAccessCache: false, dlcsCache: false, delete: true },
    { flags: ["--no-delete"], collectiveAccessCache: true, dlcsCache: true, delete: false },
    { flags: ["--no-collective-access-cache", "--no-dlcs-cache", "--no-delete"], collectiveAccessCache: false, dlcsCache: false, delete: false },
  ])("resolves $flags independently", async ({ flags, ...expected }) => {
    let actual: ReturnType<typeof resolveGenerateOptions> | undefined;
    const program = createProgram(async (options) => {
      actual = resolveGenerateOptions(options);
    });

    await program.parseAsync(["generate", ...flags], { from: "user" });

    expect(actual).toEqual(expected);
  });
});
