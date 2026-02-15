/**
 * Integration test: verify setup.sh (postCreateCommand) works correctly.
 *
 * Builds a test image using Dockerfile.setup-test and verifies:
 * - Copies config from host mount to ~/.pi
 * - Handles missing host config gracefully
 * - Creates writable directories
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execSync } from "node:child_process";
import {
  mkdirSync,
  writeFileSync,
  rmSync,
} from "node:fs";
import { resolve, join } from "node:path";
import { tmpdir } from "node:os";

const PROJECT_ROOT = resolve(__dirname, "../..");
const TEST_IMAGE = "pi-setup-test";

let fixtureDir: string;

function dockerRun(cmd: string, extraArgs: string = ""): string {
  return execSync(
    `docker run --rm ${extraArgs} ${TEST_IMAGE} bash -c "${cmd}"`,
    { encoding: "utf-8", timeout: 30000 }
  ).trim();
}

describe("setup.sh", () => {
  beforeAll(() => {
    // Create fixture directories simulating host mounts
    fixtureDir = join(tmpdir(), `pi-setup-fixture-${Date.now()}`);

    // Simulate /opt/pi-host-config (host's ~/.pi)
    const hostConfig = join(fixtureDir, "host-config");
    mkdirSync(join(hostConfig, "agent", "skills"), { recursive: true });
    mkdirSync(join(hostConfig, "skills"), { recursive: true });
    writeFileSync(join(hostConfig, "agent", "AGENTS.md"), "# Test AGENTS.md");
    writeFileSync(join(hostConfig, "config.json"), '{"test": true}');

    console.log("Building setup test image...");
    execSync(
      `docker build -t ${TEST_IMAGE} -f test/integration/Dockerfile.setup-test .`,
      {
        cwd: PROJECT_ROOT,
        timeout: 600000,
        stdio: "inherit",
      }
    );
  }, 600000);

  afterAll(() => {
    try {
      execSync(`docker rmi ${TEST_IMAGE}`, { stdio: "pipe" });
    } catch {}
    try {
      rmSync(fixtureDir, { recursive: true, force: true });
    } catch {}
  });

  it("creates ~/.pi directory", () => {
    const hostConfigPath = join(fixtureDir, "host-config").split("\\").join("/");
    const result = dockerRun(
      "/opt/pi/setup.sh && test -d /home/testuser/.pi && echo yes",
      `-v "${hostConfigPath}:/opt/pi-host-config:ro"`
    );
    expect(result).toContain("yes");
  });

  it("copies agent config from host mount", () => {
    const hostConfigPath = join(fixtureDir, "host-config").split("\\").join("/");
    const result = dockerRun(
      "/opt/pi/setup.sh && cat /home/testuser/.pi/agent/AGENTS.md",
      `-v "${hostConfigPath}:/opt/pi-host-config:ro"`
    );
    expect(result).toContain("Test AGENTS.md");
  });

  it("copies config.json from host mount", () => {
    const hostConfigPath = join(fixtureDir, "host-config").split("\\").join("/");
    const result = dockerRun(
      "/opt/pi/setup.sh && cat /home/testuser/.pi/config.json",
      `-v "${hostConfigPath}:/opt/pi-host-config:ro"`
    );
    expect(result).toContain('"test": true');
  });

  it("creates writable dirs even without host config", () => {
    const result = dockerRun(
      "/opt/pi/setup.sh && test -d /home/testuser/.pi/todos && test -d /home/testuser/.pi/memoria && echo yes"
    );
    expect(result).toContain("yes");
  });

  it("handles missing host config gracefully", () => {
    const result = dockerRun("/opt/pi/setup.sh && echo success");
    expect(result).toContain("success");
  });
});
