#!/usr/bin/env node

/**
 * pi-devcontainers — Launch dev containers with pi pre-installed.
 *
 * Usage:
 *   npx pi-devcontainers up [options]
 *   npx pi-devcontainers attach [options]
 *   npx pi-devcontainers down [options]
 *   npx pi-devcontainers status
 */

import { commandUp } from "./commands/up.js";
import { commandAttach } from "./commands/attach.js";
import { commandDown } from "./commands/down.js";
import { commandRun } from "./commands/run.js";
import { commandStatus } from "./commands/status.js";

interface ParsedArgs {
  command: string;
  workspaceFolder: string;
  mode?: "holdpty" | "pi-server";
  writable: string[];
  env: Record<string, string | null>;
  rebuild: boolean;
  verbose: boolean;
  noExtensions: boolean;
  sessionName?: string;
}

function parseArgs(argv: string[]): ParsedArgs {
  const args = argv.slice(2); // skip node and script
  const result: ParsedArgs = {
    command: args[0] ?? "help",
    workspaceFolder: process.cwd(),
    writable: [],
    env: {},
    rebuild: false,
    verbose: false,
    noExtensions: false,
  };

  let i = 1;
  while (i < args.length) {
    const arg = args[i];

    switch (arg) {
      case "--workspace-folder":
      case "-w":
        result.workspaceFolder = args[++i] ?? process.cwd();
        break;
      case "--mode":
        result.mode = args[++i] as "holdpty" | "pi-server";
        break;
      case "--writable":
        result.writable.push(args[++i] ?? "");
        break;
      case "--env":
      case "-e": {
        const envArg = args[++i] ?? "";
        const eqIndex = envArg.indexOf("=");
        if (eqIndex > 0) {
          // KEY=VALUE → explicit value
          result.env[envArg.substring(0, eqIndex)] =
            envArg.substring(eqIndex + 1);
        } else {
          // KEY only → copy from host (null)
          result.env[envArg] = null;
        }
        break;
      }
      case "--rebuild":
        result.rebuild = true;
        break;
      case "--verbose":
      case "-v":
        result.verbose = true;
        break;
      case "--no-extensions":
        result.noExtensions = true;
        break;
      case "--session":
      case "--name":
        result.sessionName = args[++i];
        break;
      default:
        if (!arg?.startsWith("-")) {
          // Positional — could be session name for attach
          if (result.command === "attach" || result.command === "down") {
            result.sessionName = arg;
          }
        }
    }
    i++;
  }

  return result;
}

function printHelp(): void {
  console.log(`
pi-devcontainers — Launch dev containers with pi pre-installed.

Commands:
  run      Up + attach + down (like docker run)
  up       Create and start a devcontainer with pi
  attach   Attach to a running pi session
  down     Stop and remove the devcontainer
  status   List running pi devcontainers

Options:
  -w, --workspace-folder <path>  Project path (default: cwd)
  --mode <holdpty|pi-server>     Override run mode
  --writable <path>              Additional writable path (repeatable)
  -e, --env <KEY=VALUE|KEY>      Env var (KEY=VALUE: set, KEY: copy from host)
  --rebuild                      Force rebuild of container
  -v, --verbose                  Show full devcontainer build output
  --no-extensions                Skip extension packing

Examples:
  npx pi-devcontainers up -w /c/dev/my-project
  npx pi-devcontainers up --env BROKER_URL --env CUSTOM=value
  npx pi-devcontainers attach -w /c/dev/my-project
  npx pi-devcontainers down -w /c/dev/my-project
`);
}

async function main(): Promise<void> {
  const parsed = parseArgs(process.argv);

  switch (parsed.command) {
    case "up":
      await commandUp({
        workspaceFolder: parsed.workspaceFolder,
        mode: parsed.mode,
        writable: parsed.writable,
        env: parsed.env,
        rebuild: parsed.rebuild,
        verbose: parsed.verbose,
        noExtensions: parsed.noExtensions,
      });
      break;

    case "run":
      await commandRun({
        workspaceFolder: parsed.workspaceFolder,
        mode: parsed.mode,
        writable: parsed.writable,
        env: parsed.env,
        rebuild: parsed.rebuild,
        verbose: parsed.verbose,
        noExtensions: parsed.noExtensions,
        sessionName: parsed.sessionName,
      });
      break;

    case "attach":
      await commandAttach({
        workspaceFolder: parsed.workspaceFolder,
        sessionName: parsed.sessionName,
      });
      break;

    case "down":
      await commandDown({
        workspaceFolder: parsed.workspaceFolder,
      });
      break;

    case "status":
      await commandStatus();
      break;

    case "help":
    case "--help":
    case "-h":
      printHelp();
      break;

    default:
      console.error(`Unknown command: ${parsed.command}`);
      printHelp();
      process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(`Fatal: ${err instanceof Error ? err.message : err}`);
  process.exitCode = 1;
});
