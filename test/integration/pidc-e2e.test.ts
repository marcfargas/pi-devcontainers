/**
 * E2E tests for pidc wrapper (up → exec → down).
 *
 * Core idea: pidc sets up a container environment for pi. We test that
 * environment by replacing `pi` with simple commands — whoami, pwd, cat,
 * touch — and checking what they see. No pi binary needed.
 *
 * The pi feature is skipped (tested separately in feature-install.test.ts).
 * We only test what the wrapper is responsible for: mounts, user, env, CWD.
 *
 * IMPORTANT: These tests must run on the HOST (not inside a devcontainer).
 * pidc is a host tool that talks to the Docker daemon — paths must match.
 * Run with: npm run test:e2e
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdirSync, writeFileSync, rmSync, chmodSync } from "node:fs";
import { join, basename, resolve } from "node:path";
import { tmpdir } from "node:os";
import {
  devcontainerUp,
  devcontainerExec,
  findContainersByLabel,
  dockerStopAndRemove,
} from "../../packages/cli/src/exec.js";
import { mergeDevcontainerJson, type DevcontainerJson } from "../../packages/cli/src/merge.js";
import { normalizePath, piConfigDir, dockerMountPath } from "../../packages/cli/src/paths.js";
import type { PiDevcontainerConfig } from "../../packages/cli/src/config.js";

// ─── Setup helpers ──────────────────────────────────────────────────

const BASE_CONFIG: PiDevcontainerConfig = {
  nodeVersion: "22.14.0",
  piVersion: "latest",
  mode: "holdpty",
  writable: ["todos", "memoria"],
  extensions: "skip",
  env: {},
  features: {},
  defaultImage: "mcr.microsoft.com/devcontainers/base:ubuntu",
};

function createProject(name: string, dc?: Record<string, unknown>): string {
  const dir = join(tmpdir(), `pidc-e2e-${name}-${Date.now()}`);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "README.md"), `# ${name}\n`);
  if (dc) {
    mkdirSync(join(dir, ".devcontainer"), { recursive: true });
    writeFileSync(join(dir, ".devcontainer", "devcontainer.json"), JSON.stringify(dc, null, 2));
  }
  return dir;
}

function createFakePi(): string {
  const dir = join(tmpdir(), `pidc-e2e-pi-${Date.now()}`);
  mkdirSync(join(dir, "agent"), { recursive: true });
  mkdirSync(join(dir, "todos"), { recursive: true });
  mkdirSync(join(dir, "memoria"), { recursive: true });
  writeFileSync(join(dir, "agent", "auth.json"), '{"token":"test-secret"}');
  chmodSync(join(dir, "agent", "auth.json"), 0o644);
  writeFileSync(join(dir, "agent", "settings.json"), "{}");
  writeFileSync(join(dir, "agent", "AGENTS.md"), "# Test\n");
  return dir;
}

/**
 * Build merged config, devcontainer up, return workspace folder for exec/down.
 * Mirrors commandUp logic but skips the pi feature and uses a fake ~/.pi.
 */
function up(projectDir: string, piDir: string, dc?: DevcontainerJson): string {
  const wf = normalizePath(projectDir);
  const user = dc?.remoteUser as string | undefined;
  const primary = user ? (user === "root" ? "/root" : `/home/${user}`) : "/root";
  const extras = ["/root", "/home/vscode", "/home/node"].filter((h) => h !== primary);

  const merged = mergeDevcontainerJson(dc ?? {}, BASE_CONFIG, {}, {
    featureRef: "ghcr.io/marcfargas/devcontainer-features/pi:0",
    containerHome: primary,
    additionalContainerHomes: extras,
    settingsMounts: [],
    workspaceFolderBasename: basename(projectDir),
  });

  // Strip pi feature — not needed, avoids ghcr.io auth + speeds up container start
  delete merged.features?.["ghcr.io/marcfargas/devcontainer-features/pi:0"];
  if (merged.features && Object.keys(merged.features).length === 0) delete merged.features;

  // Point mounts at our fake pi dir instead of real ~/.pi
  const realPi = dockerMountPath(piConfigDir());
  const fakePi = dockerMountPath(piDir);
  if (Array.isArray(merged.mounts)) {
    merged.mounts = (merged.mounts as Array<Record<string, unknown>>).map((m) => {
      const src = m.source as string;
      if (!src) return m;
      if (src === realPi) return { ...m, source: fakePi };
      if (src.startsWith(realPi + "/")) return { ...m, source: fakePi + src.slice(realPi.length) };
      return m;
    });
  }

  const tmp = join(tmpdir(), `pidc-e2e-cfg-${Date.now()}`);
  mkdirSync(tmp, { recursive: true });
  const configPath = join(tmp, "devcontainer.json");
  writeFileSync(configPath, JSON.stringify(merged, null, 2));
  try {
    devcontainerUp({ workspaceFolder: wf, configPath });
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
  return wf;
}

/** Run a command inside the container, return trimmed stdout. */
function exec(wf: string, cmd: string): string {
  return devcontainerExec(wf, ["bash", "-c", cmd]).trim();
}

function down(wf: string): void {
  for (const id of findContainersByLabel(wf)) dockerStopAndRemove(id);
}

// ─── Tests ──────────────────────────────────────────────────────────

describe("pidc e2e", () => {
  let piDir: string;
  const dirs: string[] = [];
  const containers: string[] = [];

  function tracked(projectDir: string, wf: string): string {
    dirs.push(projectDir);
    containers.push(wf);
    return wf;
  }

  beforeAll(() => { piDir = createFakePi(); dirs.push(piDir); });
  afterAll(() => {
    for (const wf of containers) { try { down(wf); } catch {} }
    for (const d of dirs) { try { rmSync(d, { recursive: true, force: true }); } catch {} }
  });

  // ── root user (default, no devcontainer.json) ─────────────────

  describe("root user (no devcontainer.json)", () => {
    let wf: string;
    let ws: string;

    beforeAll(() => {
      const p = createProject("root");
      wf = tracked(p, up(p, piDir));
      ws = `/workspaces/${basename(wf)}`;
    }, 300000);

    it("whoami → root",        () => expect(exec(wf, "whoami")).toBe("root"));
    it("HOME → /root",         () => expect(exec(wf, "echo $HOME")).toBe("/root"));
    it("PI_DEVCONTAINER is 1", () => expect(exec(wf, "echo $PI_DEVCONTAINER")).toBe("1"));
    it("TERM is xterm-256color",() => expect(exec(wf, "echo $TERM")).toBe("xterm-256color"));
    it("workspace has README",  () => expect(exec(wf, `cat ${ws}/README.md`)).toContain("root"));

    it("~/.pi/agent/auth.json readable",   () => expect(exec(wf, "cat /root/.pi/agent/auth.json")).toContain("test-secret"));
    it("~/.pi/agent/AGENTS.md exists",     () => expect(exec(wf, "cat /root/.pi/agent/AGENTS.md")).toContain("Test"));
    it("~/.pi/todos is writable",          () => expect(exec(wf, "touch /root/.pi/todos/x && echo ok")).toBe("ok"));
    it("~/.pi/memoria is writable",        () => expect(exec(wf, "touch /root/.pi/memoria/x && echo ok")).toBe("ok"));

    it("bash -lc cd works (holdpty CWD pattern)", () => {
      expect(exec(wf, `cd '${ws}' && pwd`)).toBe(ws);
    });
  });

  // ── node user ─────────────────────────────────────────────────

  describe("node user", () => {
    let wf: string;
    let ws: string;
    const dc: DevcontainerJson = {
      image: "mcr.microsoft.com/devcontainers/javascript-node:22",
      remoteUser: "node",
    };

    beforeAll(() => {
      const p = createProject("node", dc as Record<string, unknown>);
      wf = tracked(p, up(p, piDir, dc));
      ws = `/workspaces/${basename(wf)}`;
    }, 300000);

    it("whoami → node",  () => expect(exec(wf, "whoami")).toBe("node"));
    it("HOME → /home/node", () => expect(exec(wf, "echo $HOME")).toBe("/home/node"));

    it("auth.json readable at /home/node/.pi",  () => expect(exec(wf, "cat /home/node/.pi/agent/auth.json")).toContain("test-secret"));
    it("AGENTS.md exists at /home/node/.pi",    () => expect(exec(wf, "cat /home/node/.pi/agent/AGENTS.md")).toContain("Test"));
    it("todos writable as node",                () => expect(exec(wf, "touch /home/node/.pi/todos/x && echo ok")).toBe("ok"));
    it("memoria writable as node",              () => expect(exec(wf, "touch /home/node/.pi/memoria/x && echo ok")).toBe("ok"));

    it("workspace has README",   () => expect(exec(wf, `cat ${ws}/README.md`)).toContain("node"));
    it("PI_DEVCONTAINER is set", () => expect(exec(wf, "echo $PI_DEVCONTAINER")).toBe("1"));

    it("holdpty CWD pattern runs as node in workspace", () => {
      const out = exec(wf, `cd '${ws}' && pwd && whoami`);
      expect(out).toBe(`${ws}\nnode`);
    });
  });

  // ── vscode user ───────────────────────────────────────────────

  describe("vscode user", () => {
    let wf: string;
    const dc: DevcontainerJson = {
      image: "mcr.microsoft.com/devcontainers/base:ubuntu",
      remoteUser: "vscode",
    };

    beforeAll(() => {
      const p = createProject("vscode", dc as Record<string, unknown>);
      wf = tracked(p, up(p, piDir, dc));
    }, 300000);

    it("whoami → vscode",     () => expect(exec(wf, "whoami")).toBe("vscode"));
    it("HOME → /home/vscode", () => expect(exec(wf, "echo $HOME")).toBe("/home/vscode"));
    it("auth.json readable",  () => expect(exec(wf, "cat /home/vscode/.pi/agent/auth.json")).toContain("test-secret"));
    it("todos writable",      () => expect(exec(wf, "touch /home/vscode/.pi/todos/x && echo ok")).toBe("ok"));
  });

  // ── remoteEnv ─────────────────────────────────────────────────

  describe("remoteEnv", () => {
    let wf: string;
    const dc: DevcontainerJson = {
      image: "mcr.microsoft.com/devcontainers/base:ubuntu",
      remoteEnv: { MY_VAR: "e2e-value" },
    };

    beforeAll(() => {
      const p = createProject("env", dc as Record<string, unknown>);
      wf = tracked(p, up(p, piDir, dc));
    }, 300000);

    it("project env var is set",   () => expect(exec(wf, "echo $MY_VAR")).toBe("e2e-value"));
    it("pi env vars also present", () => expect(exec(wf, "echo $PI_DEVCONTAINER")).toBe("1"));
  });

  // ── down ──────────────────────────────────────────────────────

  describe("down", () => {
    it("removes the container", () => {
      const p = createProject("down");
      dirs.push(p);
      const wf = up(p, piDir);

      expect(findContainersByLabel(wf).length).toBeGreaterThan(0);
      down(wf);
      expect(findContainersByLabel(wf).length).toBe(0);
    }, 300000);
  });

  // ── isolation ─────────────────────────────────────────────────

  describe("isolation", () => {
    it("two projects get separate containers", () => {
      const pA = createProject("iso-a");
      const pB = createProject("iso-b");
      dirs.push(pA, pB);

      const wfA = up(pA, piDir);
      const wfB = up(pB, piDir);
      containers.push(wfA, wfB);

      const idsA = findContainersByLabel(wfA);
      const idsB = findContainersByLabel(wfB);
      expect(idsA.length).toBeGreaterThan(0);
      expect(idsB.length).toBeGreaterThan(0);
      expect(idsA[0]).not.toBe(idsB[0]);

      expect(exec(wfA, `cat /workspaces/${basename(wfA)}/README.md`)).toContain("iso-a");
      expect(exec(wfB, `cat /workspaces/${basename(wfB)}/README.md`)).toContain("iso-b");
    }, 300000);
  });
});
