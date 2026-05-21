import path from 'node:path';

import type { WorkspaceContainerConfig } from '../types.js';
import type { DockerContainerManager } from '../container-manager.js';
import type { ExecBackend, ExecOpts, ExecResult, SyncSkillEntry, BackendFactoryContext, DockerExecBackendConfig } from '../exec-backend.js';
import { HostFileBackend, type FileBackend } from './file-backend.js';
import { registerExecBackend } from '../exec-backend.js';
import { syncSkillsToHostDir } from './shared.js';

const DOCKER_DEFAULT_USERNAME = 'root';
const DOCKER_DEFAULT_AGENT_HOME = '/root';

class DockerExecBackend implements ExecBackend {
  readonly id: string;
  readonly type = 'docker';
  readonly label: string;
  readonly username: string;
  readonly agentHome: string;
  readonly files: FileBackend;
  private readonly config: WorkspaceContainerConfig;

  private readonly containerManager: DockerContainerManager;
  private readonly agentId: string;
  private readonly workspaceDir: string;
  private readonly context: BackendFactoryContext;

  /** Concurrent guard: prevents multiple parallel ensure() calls from
   *  creating duplicate containers. When one ensure is in-flight, subsequent
   *  callers await the same promise. */
  private ensurePromise: Promise<void> | null = null;

  constructor(
    config: DockerExecBackendConfig,
    context: BackendFactoryContext,
  ) {
    this.context = context;
    this.containerManager = context.containerManager;
    this.agentId = context.agentId;
    this.workspaceDir = context.workspaceDir;
    this.id = config.id ?? 'docker';
    this.label = config.label ?? `Docker (${config.image})`;
    this.username = config.username ?? DOCKER_DEFAULT_USERNAME;
    this.agentHome = config.agent_home ?? DOCKER_DEFAULT_AGENT_HOME;
    this.config = {
      image: config.image,
      mount_target: this.agentHome,
      username: this.username,
      ...(config.memory_limit ? { memory_limit: config.memory_limit } : {}),
      ...(config.cpu_shares ? { cpu_shares: config.cpu_shares } : {}),
      ...(config.lifecycle ? { lifecycle: config.lifecycle } : {}),
    };
    this.files = new HostFileBackend(this.workspaceDir, this.agentHome);
  }

  async ensure(): Promise<void> {
    // If an ensure is already in-flight, return the same promise to avoid
    // duplicate container creation (concurrent exec calls race condition).
    if (this.ensurePromise) {
      return this.ensurePromise;
    }

    this.ensurePromise = this.ensureInternal().finally(() => {
      // Release the lock after completion (success or failure).
      this.ensurePromise = null;
    });

    return this.ensurePromise;
  }

  private async ensureInternal(): Promise<void> {
    const entry = await this.containerManager.ensureWorkspaceContainer(this.agentId, this.config);
    await this.context.markActive?.({
      externalId: entry.name ?? null,
      lastSeenAt: new Date().toISOString(),
    });
  }

  async exec(command: string, opts?: ExecOpts): Promise<ExecResult> {
    // Ensure container is running before executing. The concurrent guard
    // in ensure() prevents duplicate starts if called multiple times.
    // This also handles state drift (e.g. container stopped externally).
    await this.ensure();
    return this.containerManager.execInWorkspace(this.agentId, command, opts?.cwd);
  }

  async syncSkills(skills: SyncSkillEntry[]): Promise<void> {
    await syncSkillsToHostDir(
      path.join(this.workspaceDir, '.openhermit', 'skills'),
      skills,
    );
  }

  async shutdown(): Promise<void> {
    await this.containerManager.stopWorkspaceContainer(this.agentId);
  }
}

registerExecBackend('docker', (config, context) =>
  new DockerExecBackend(config as DockerExecBackendConfig, context),
);
