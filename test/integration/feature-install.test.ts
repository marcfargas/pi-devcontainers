/**
 * Integration test: verify the feature install.sh works in a Docker container.
 *
 * Runs install.sh inside a Docker container and verifies:
 * - Node.js is installed to /opt/pi
 * - pi is installed and the wrapper works
 * - holdpty is installed and the wrapper works
 * - The container's own node (if any) is not affected
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execSync } from "node:child_process";
import { resolve } from "node:path";

const FEATURE_DIR = resolve(__dirname, "../../packages/feature");
const TEST_IMAGE = "pi-devcontainer-test";

describe("feature install.sh", () => {
  beforeAll(() => {
    // Build a test image that runs install.sh
    const dockerfile = `
FROM ubuntu:22.04
RUN apt-get update && apt-get install -y curl ca-certificates xz-utils
# Install a "project" node to verify isolation
RUN curl -fsSL https://deb.nodesource.com/setup_20.x | bash - && apt-get install -y nodejs
COPY install.sh /tmp/install.sh
RUN chmod +x /tmp/install.sh
ENV NODEVERSION=22.14.0
ENV PIVERSION=latest
RUN /tmp/install.sh
`;

    execSync(
      `docker build -t ${TEST_IMAGE} -f - "${FEATURE_DIR}" <<'DOCKERFILE'\n${dockerfile}\nDOCKERFILE`,
      {
        timeout: 600000,
        stdio: "inherit",
        shell: "/bin/bash",
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

  function dockerRun(cmd: string): string {
    return execSync(`docker run --rm ${TEST_IMAGE} bash -c "${cmd}"`, {
      encoding: "utf-8",
      timeout: 30000,
    }).trim();
  }

  it("installs node to /opt/pi", () => {
    const version = dockerRun("/opt/pi/bin/node --version");
    expect(version).toMatch(/^v22\./);
  });

  it("does not affect the container's own node", () => {
    // The "project" node should still be v20
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
    // The wrapper should use /opt/pi/bin/node, not the system node
    const wrapper = dockerRun("cat /usr/local/bin/pi");
    expect(wrapper).toContain("/opt/pi/bin/node");
  });

  it("holdpty wrapper uses the isolated node", () => {
    const wrapper = dockerRun("cat /usr/local/bin/holdpty");
    expect(wrapper).toContain("/opt/pi/bin/node");
  });

  it("/opt/pi/bin is NOT in PATH", () => {
    // Verify isolation: /opt/pi shouldn't be in the default PATH
    const path = dockerRun("echo $PATH");
    expect(path).not.toContain("/opt/pi");
  });
});
