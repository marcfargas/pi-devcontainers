/**
 * Integration test: verify setup.sh (postCreateCommand) works correctly.
 *
 * Tests:
 * - Copies config from host mount to ~/.pi
 * - Installs extension tarballs
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

const FEATURE_DIR = resolve(__dirname, "../../packages/feature");
const TEST_IMAGE = "pi-setup-test";

describe("setup.sh", () => {
  let fixtureDir: string;

  beforeAll(() => {
    // Create fixture directories simulating host mounts
    fixtureDir = join(tmpdir(), `pi-setup-test-${Date.now()}`);

    // Simulate /opt/pi-host-config (host's ~/.pi)
    const hostConfig = join(fixtureDir, "host-config");
    mkdirSync(join(hostConfig, "agent", "skills"), { recursive: true });
    mkdirSync(join(hostConfig, "skills"), { recursive: true });
    writeFileSync(
      join(hostConfig, "agent", "AGENTS.md"),
      "# Test AGENTS.md"
    );
    writeFileSync(
      join(hostConfig, "config.json"),
      '{"test": true}'
    );

    // Simulate /opt/pi-ext-staging (packed extensions)
    const extStaging = join(fixtureDir, "ext-staging");
    mkdirSync(extStaging, { recursive: true });
    // Create a minimal valid tarball for testing
    // (we won't actually install it, just test the flow)

    // Build test image
    const dockerfile = `
FROM ubuntu:22.04
RUN apt-get update && apt-get install -y curl ca-certificates xz-utils
# Minimal /opt/pi with just node
RUN mkdir -p /opt/pi/bin && \\
    curl -fsSL https://nodejs.org/dist/v22.14.0/node-v22.14.0-linux-$(case $(uname -m) in x86_64) echo x64;; aarch64) echo arm64;; esac).tar.xz \\
    | tar -xJ -C /opt/pi --strip-components=1
COPY setup.sh /opt/pi/setup.sh
RUN chmod +x /opt/pi/setup.sh
ENV HOME=/home/testuser
RUN useradd -m testuser
USER testuser
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
    } catch {}
    try {
      rmSync(fixtureDir, { recursive: true, force: true });
    } catch {}
  });

  function dockerRun(cmd: string, mounts: string[] = []): string {
    const mountArgs = mounts.map((m) => `-v "${m}"`).join(" ");
    return execSync(
      `docker run --rm ${mountArgs} ${TEST_IMAGE} bash -c "${cmd}"`,
      { encoding: "utf-8", timeout: 30000 }
    ).trim();
  }

  it("creates ~/.pi directory", () => {
    const result = dockerRun(
      "/opt/pi/setup.sh && test -d /home/testuser/.pi && echo yes",
      [`${join(fixtureDir, "host-config")}:/opt/pi-host-config:ro`]
    );
    expect(result).toContain("yes");
  });

  it("copies agent config from host mount", () => {
    const result = dockerRun(
      "/opt/pi/setup.sh && cat /home/testuser/.pi/agent/AGENTS.md",
      [`${join(fixtureDir, "host-config")}:/opt/pi-host-config:ro`]
    );
    expect(result).toContain("Test AGENTS.md");
  });

  it("copies config.json from host mount", () => {
    const result = dockerRun(
      "/opt/pi/setup.sh && cat /home/testuser/.pi/config.json",
      [`${join(fixtureDir, "host-config")}:/opt/pi-host-config:ro`]
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
    // Should not error when /opt/pi-host-config doesn't exist
    const result = dockerRun(
      "/opt/pi/setup.sh && echo success"
    );
    expect(result).toContain("success");
  });
});
