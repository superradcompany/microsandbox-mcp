import assert from "node:assert/strict";
import test from "node:test";

import { registerResources } from "../dist/resources.js";
import { registerExecTools } from "../dist/tools/exec.js";
import { registerFilesystemTools } from "../dist/tools/filesystem.js";
import { registerImageTools } from "../dist/tools/image.js";
import { registerLogTools } from "../dist/tools/logs.js";
import { registerMetricsTools } from "../dist/tools/metrics.js";
import { registerRuntimeTools } from "../dist/tools/runtime.js";
import { registerSandboxTools } from "../dist/tools/sandbox.js";
import { registerSnapshotTools } from "../dist/tools/snapshot.js";
import { registerSshTools } from "../dist/tools/ssh.js";
import { registerVolumeTools } from "../dist/tools/volume.js";

class FakeServer {
  tools = [];
  resources = [];

  registerTool(name, config, handler) {
    this.tools.push({ name, config, handler });
  }

  registerResource(name, uri, config, handler) {
    this.resources.push({ name, uri, config, handler });
  }
}

test("registers the full tool catalog", () => {
  const server = new FakeServer();
  registerRuntimeTools(server);
  registerSandboxTools(server);
  registerExecTools(server);
  registerLogTools(server);
  registerFilesystemTools(server);
  registerVolumeTools(server);
  registerMetricsTools(server);
  registerImageTools(server);
  registerSnapshotTools(server);
  registerSshTools(server);

  const expectedTools = [
    "runtime_check",
    "runtime_install",
    "sandbox_run",
    "sandbox_create",
    "sandbox_start",
    "sandbox_list",
    "sandbox_status",
    "sandbox_inspect",
    "sandbox_stop",
    "sandbox_drain",
    "sandbox_wait",
    "sandbox_remove",
    "sandbox_exec",
    "sandbox_shell",
    "sandbox_exec_start",
    "sandbox_exec_poll",
    "sandbox_exec_write_stdin",
    "sandbox_exec_signal",
    "sandbox_exec_close",
    "sandbox_logs_read",
    "sandbox_logs_stream",
    "sandbox_fs_read",
    "sandbox_fs_write",
    "sandbox_fs_list",
    "sandbox_fs_mkdir",
    "sandbox_fs_remove",
    "sandbox_fs_copy",
    "sandbox_fs_rename",
    "sandbox_fs_stat",
    "sandbox_fs_exists",
    "sandbox_fs_copy_from_host",
    "sandbox_fs_copy_to_host",
    "volume_create",
    "volume_list",
    "volume_inspect",
    "volume_remove",
    "volume_fs_read",
    "volume_fs_write",
    "volume_fs_list",
    "volume_fs_mkdir",
    "volume_fs_remove",
    "volume_fs_copy",
    "volume_fs_rename",
    "volume_fs_stat",
    "volume_fs_exists",
    "sandbox_metrics",
    "sandbox_metrics_all",
    "sandbox_metrics_stream",
    "image_list",
    "image_inspect",
    "image_remove",
    "image_prune",
    "snapshot_create",
    "snapshot_list",
    "snapshot_inspect",
    "snapshot_verify",
    "snapshot_remove",
    "snapshot_reindex",
    "snapshot_export",
    "snapshot_import",
    "sandbox_ssh_exec",
    "sandbox_sftp_read",
    "sandbox_sftp_write",
    "sandbox_sftp_mkdir",
    "sandbox_sftp_remove",
    "sandbox_sftp_rename",
    "sandbox_sftp_realpath",
    "sandbox_sftp_readlink",
    "sandbox_sftp_symlink",
  ];

  assert.deepEqual(server.tools.map((tool) => tool.name), expectedTools);
  assert.equal(server.tools.find((tool) => tool.name === "runtime_check").config.annotations.readOnlyHint, true);
  assert.equal(server.tools.find((tool) => tool.name === "sandbox_fs_copy_from_host").config.annotations.readOnlyHint, false);
  assert.equal(server.tools.find((tool) => tool.name === "image_prune").config.annotations.destructiveHint, true);
});

test("registers the read-only resource catalog", () => {
  const server = new FakeServer();
  registerResources(server);

  assert.deepEqual(server.resources.map((resource) => resource.uri), [
    "microsandbox://runtime",
    "microsandbox://sandboxes",
    "microsandbox://volumes",
    "microsandbox://images",
    "microsandbox://snapshots",
    "microsandbox://schemas/sandbox-create",
    "microsandbox://policy",
  ]);
});
