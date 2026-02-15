/**
 * Integration test: verify the feature install.sh works in a Docker container.
 *
 * Builds a test image using Dockerfile.feature-test and verifies:
 * - Node.js is installed to /opt/pi
 * - pi is installed and the wrapper works
 * - holdpty is installed and the wrapper works
 * - The container's own node (if any) is not affected
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execSync } from "node:child_process";
import { resolve } from "node:path";

const PROJECT_ROOT = resolve(__dirname, "../..");
const TEST_IMAGE = "pi-feature-test";

function dockerRun(cmd: string): string {
  return execSync(`docker run --rm ${TEST_IMAGE} bash -c "${cmd}"`, {
    encoding: "utf-8",
    timeout: 30000,
  }).trim();
}

describe("feature install.sh", () => {
  beforeAll(() => {
    console.log("Building feature test image (this may take a few minutes)...");
    execSync(
      `docker build -t ${TEST_IMAGE} -f test/integration/Dockerfile.feature-test .`,
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
    } catch {
      // cleanup failure ok
    }
  });

  it("installs node to /opt/pi with the requested version", () => {
    const version = dockerRun("/opt/pi/bin/node --version");
    expect(version).toMatch(/^v22\./);
  });

  it("does not affect the container's own node", () => {
    const version = dockerRun("node --version");
    expect(version).toMatch(/^v20\./);
  });

  it("installs pi wrapper in /usr/local/bin", () => {
    const exists = dockerRun("test -x /usr/local/bin/pi && echo yes");
    expect(exists).toBe("yes");
  });

  it("installs holdpty wrapper in /usr/local/bin", () => {
    const exists = dockerRun("test -x /usr/local/bin/holdpty && echo yes");
    expect(exists).toBe("yes");
  });

  it("pi wrapper uses the isolated node", () => {
    const wrapper = dockerRun("cat /usr/local/bin/pi");
    expect(wrapper).toContain("/opt/pi/bin/node");
  });

  it("holdpty wrapper uses the isolated node", () => {
    const wrapper = dockerRun("cat /usr/local/bin/holdpty");
    expect(wrapper).toContain("/opt/pi/bin/node");
  });

  it("/opt/pi/bin is NOT in default PATH", () => {
    const path = dockerRun("echo \\$PATH");
    expect(path).not.toContain("/opt/pi");
  });

  it("npm in /opt/pi works independently", () => {
    const version = dockerRun("/opt/pi/bin/npm --version");
    expect(version).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
