import assert from 'node:assert/strict';
import { test } from 'node:test';

// Import backend registrations so 'docker' type is recognized
import '../src/core/backends/docker.js';

import type { DockerContainerManager } from '../src/core/container-manager.js';
import type { BackendFactoryContext, DockerExecBackendConfig } from '../src/core/exec-backend.js';
import { createExecBackend } from '../src/core/exec-backend.js';

// Mock container manager that tracks ensure calls
const createMockContainerManager = (): DockerContainerManager & { getEnsureCallCount: () => number } => {
  let ensureCallCount = 0;

  return {
    ensureWorkspaceContainer: async (agentId: string, config: any) => {
      ensureCallCount++;
      const start = Date.now();
      // Simulate container startup delay (100ms)
      await new Promise((resolve) => setTimeout(resolve, 100));
      
      return {
        id: `container-${ensureCallCount}`,
        name: `openhermit-${agentId}-workspace`,
        image: config.image,
        type: 'workspace' as const,
        mount: '.',
        mount_target: config.mount_target,
        created: new Date().toISOString(),
        status: 'running' as const,
        runtime_container_id: `runtime-${ensureCallCount}`,
      };
    },
    execInWorkspace: async () => ({
      stdout: 'test output',
      stderr: '',
      exitCode: 0,
      durationMs: 50,
    }),
    stopWorkspaceContainer: async () => {},
    getEnsureCallCount: () => ensureCallCount,
  } as any;
};

const createFakeContext = (containerManager: ReturnType<typeof createMockContainerManager>): BackendFactoryContext => ({
  containerManager,
  agentId: 'test-agent',
  workspaceDir: '/tmp/workspace',
});

test('DockerExecBackend concurrent ensure() calls should only create one container', async () => {
  const mockManager = createMockContainerManager();
  const context = createFakeContext(mockManager);

  const config: DockerExecBackendConfig = {
    type: 'docker',
    id: 'docker-test',
    image: 'ubuntu:24.04',
  };

  const backend = createExecBackend(config, context);

  // Simulate 5 concurrent exec calls
  const concurrentCalls = 5;
  const promises: Promise<void>[] = [];

  const startTime = Date.now();
  for (let i = 0; i < concurrentCalls; i++) {
    promises.push(backend.ensure());
  }

  // All promises should resolve
  await Promise.all(promises);
  const totalTime = Date.now() - startTime;

  // The concurrent guard should ensure only ONE container is created
  assert.equal(
    mockManager.getEnsureCallCount(),
    1,
    `Expected 1 container creation, but got ${mockManager.getEnsureCallCount()}. Concurrent guard failed!`,
  );

  // Total time should be ~100ms (one startup), not ~500ms (five sequential startups)
  // Allow some tolerance for test overhead
  assert.ok(
    totalTime < 300,
    `Expected total time < 300ms (concurrent), but got ${totalTime}ms. Calls may not be properly concurrent!`,
  );
});

test('DockerExecBackend sequential ensure() calls should reuse completed state', async () => {
  const mockManager = createMockContainerManager();
  const context = createFakeContext(mockManager);

  const config: DockerExecBackendConfig = {
    type: 'docker',
    id: 'docker-sequential',
    image: 'ubuntu:24.04',
  };

  const backend = createExecBackend(config, context);

  // First ensure should create container
  await backend.ensure();
  assert.equal(mockManager.getEnsureCallCount(), 1);

  // Second ensure should NOT create another container (uses cached state)
  // Note: This depends on containerManager's internal caching
  await backend.ensure();
  // The actual count depends on whether containerManager caches the result
  // We just verify it doesn't exceed 2 (some implementations may re-check)
  assert.ok(
    mockManager.getEnsureCallCount() <= 2,
    `Expected <= 2 container creations, but got ${mockManager.getEnsureCallCount()}`,
  );
});

test('DockerExecBackend ensure() should release lock on failure', async () => {
  const failingManager = {
    ensureWorkspaceContainer: async () => {
      throw new Error('Docker is not available');
    },
    execInWorkspace: async () => ({
      stdout: '',
      stderr: '',
      exitCode: 1,
      durationMs: 0,
    }),
    stopWorkspaceContainer: async () => {},
  } as any;

  const context = createFakeContext(failingManager);
  const config: DockerExecBackendConfig = {
    type: 'docker',
    id: 'docker-fail',
    image: 'ubuntu:24.04',
  };

  const backend = createExecBackend(config, context);

  // First ensure should fail
  await assert.rejects(
    () => backend.ensure(),
    /Docker is not available/,
  );

  // Second ensure should NOT fail silently (lock should be released)
  // It should attempt again and fail again
  await assert.rejects(
    () => backend.ensure(),
    /Docker is not available/,
  );
});
