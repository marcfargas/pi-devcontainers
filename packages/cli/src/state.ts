/**
 * Persistent state for running pi devcontainers.
 *
 * Stores container IDs, workspace mappings, and temp dir paths
 * in ~/.pi/devcontainers-state.json so that down/attach/status
 * can find containers without re-querying devcontainer CLI.
 */

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { piConfigDir, pathExists, normalizePath } from "./paths.js";

export interface ContainerState {
  containerId: string;
  workspaceFolder: string;
  remoteWorkspaceFolder?: string; // workspace path inside container (from devcontainer up)
  configDir: string; // temp dir with merged devcontainer.json
  settingsDir?: string; // temp dir with patched settings.json
  remoteUser?: string; // from devcontainer.json remoteUser
  startedAt: string; // ISO timestamp
}

interface StateFile {
  containers: Record<string, ContainerState>; // keyed by normalized workspace path
}

function statePath(): string {
  return join(piConfigDir(), "devcontainers-state.json");
}

function readState(): StateFile {
  const p = statePath();
  if (!pathExists(p)) return { containers: {} };
  try {
    return JSON.parse(readFileSync(p, "utf-8"));
  } catch {
    return { containers: {} };
  }
}

function writeState(state: StateFile): void {
  const p = statePath();
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, JSON.stringify(state, null, 2));
}

/** Save container info after a successful `up`. */
export function saveContainer(entry: ContainerState): void {
  const state = readState();
  const key = normalizePath(entry.workspaceFolder);
  state.containers[key] = { ...entry, workspaceFolder: key };
  writeState(state);
}

/** Get container info for a workspace. */
export function getContainer(workspaceFolder: string): ContainerState | null {
  const state = readState();
  return state.containers[normalizePath(workspaceFolder)] ?? null;
}

/** Remove container info after `down`. */
export function removeContainer(workspaceFolder: string): void {
  const state = readState();
  delete state.containers[normalizePath(workspaceFolder)];
  writeState(state);
}

/** List all tracked containers. */
export function listContainers(): ContainerState[] {
  const state = readState();
  return Object.values(state.containers);
}
