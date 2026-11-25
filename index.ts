#!/usr/bin/env bun
import { Command } from "commander";
import { runGenerate, type GenerateOptions } from "./src/generate.ts";

function normalizeProcessArgv(argv: string[]) {
  const [runtime, script, ...args] = argv;
  return [runtime, script, ...args.filter((arg) => arg !== "--")];
}

async function runAction(action: () => Promise<void>) {
  try {
    await action();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

export function createProgram(
  generate: (options: GenerateOptions) => Promise<void> = runGenerate,
) {
  const program = new Command();

  program
    .name("collective-access-data")
    .description("Generate IIIF resources from CollectiveAccess OAI records.")
    .showHelpAfterError();

  program
    .command("generate")
    .description("Create or update IIIF manifests and collections.")
    .option("--oai-base-url <url>", "override the CollectiveAccess OAI base URL")
    .option(
      "--no-cache",
      "fetch fresh OAI XML responses and DLCS image information",
    )
    .option(
      "--no-collective-access-cache",
      "fetch fresh CollectiveAccess OAI XML (permits deletion after a complete harvest)",
    )
    .option("--no-dlcs-cache", "fetch fresh DLCS image information")
    .option("--no-delete", "keep generated objects and collections absent from the public export")
    .action((options: GenerateOptions) => runAction(() => generate(options)));

  return program;
}

if (import.meta.main) {
  process.on("SIGINT", () => {
    console.error("Generation interrupted.");
    process.exit(130);
  });
  await createProgram().parseAsync(normalizeProcessArgv(process.argv));
}
