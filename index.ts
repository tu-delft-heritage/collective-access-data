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

process.on("SIGINT", () => {
  console.error("Generation interrupted.");
  process.exit(130);
});

const program = new Command();

program
  .name("collective-access-data")
  .description("Generate IIIF resources from CollectiveAccess OAI records.")
  .showHelpAfterError();

program
  .command("generate")
  .description("Create or update IIIF manifests and collections.")
  .option(
    "--no-cache",
    "fetch fresh OAI XML responses and DLCS image information",
  )
  .action((options: GenerateOptions) =>
    runAction(() => runGenerate({ cache: options.cache })),
  );

await program.parseAsync(normalizeProcessArgv(process.argv));
