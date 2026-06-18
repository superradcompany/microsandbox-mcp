# microsandbox-mcp

Give your AI agents sandboxes. This MCP server connects any AI agent to [microsandbox](https://github.com/microsandbox/microsandbox) — letting them create fast lightweight sandboxes, execute code, manage files, and monitor resources.

**[Documentation](https://docs.microsandbox.dev)** | **[npm Package](https://www.npmjs.com/package/microsandbox-mcp)** | **[GitHub](https://github.com/microsandbox/microsandbox)**

## Installation

Run the server with `npx -y microsandbox-mcp` using stdio transport.

<details>
<summary><b>Claude Code</b></summary>

```bash
claude mcp add --transport stdio microsandbox -- npx -y microsandbox-mcp
```
</details>

<details>
<summary><b>Cursor</b></summary>

Add to `~/.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "microsandbox": {
      "command": "npx",
      "args": ["-y", "microsandbox-mcp"]
    }
  }
}
```
</details>

<details>
<summary><b>VS Code</b></summary>

Add to `.vscode/mcp.json`:

```json
{
  "servers": {
    "microsandbox": {
      "command": "npx",
      "args": ["-y", "microsandbox-mcp"]
    }
  }
}
```
</details>

<details>
<summary><b>Claude Desktop</b></summary>

Add to your config file:
- **macOS:** `~/Library/Application Support/Claude/claude_desktop_config.json`

```json
{
  "mcpServers": {
    "microsandbox": {
      "command": "npx",
      "args": ["-y", "microsandbox-mcp"]
    }
  }
}
```
</details>

<details>
<summary><b>Windsurf</b></summary>

Add to `~/.codeium/windsurf/mcp_config.json`:

```json
{
  "mcpServers": {
    "microsandbox": {
      "command": "npx",
      "args": ["-y", "microsandbox-mcp"]
    }
  }
}
```
</details>

<details>
<summary><b>Zed</b></summary>

Add to your Zed settings:

```json
{
  "context_servers": {
    "microsandbox": {
      "command": {
        "path": "npx",
        "args": ["-y", "microsandbox-mcp"]
      }
    }
  }
}
```
</details>

<details>
<summary><b>Other Clients</b></summary>

For any MCP client that supports stdio transport:

```json
{
  "mcpServers": {
    "microsandbox": {
      "command": "npx",
      "args": ["-y", "microsandbox-mcp"]
    }
  }
}
```
</details>

## Available Tools

Every tool returns a JSON envelope: `{ "ok": true, "data": ... }` on success or `{ "ok": false, "error": ... }` on failure. Large command output, logs, and file reads are capped by default and include truncation metadata when shortened.

**Runtime**

| Tool | Description |
| ---- | ----------- |
| `runtime_check` | Check whether the microsandbox runtime, `msb`, and `libkrunfw` are available |
| `runtime_install` | Install runtime dependencies using the microsandbox SDK installer |

**Sandbox Lifecycle**

| Tool | Description |
| ---- | ----------- |
| `sandbox_run` | Create an ephemeral sandbox, run a shell command, return output, and remove it |
| `sandbox_create` | Create and boot a persistent sandbox with rootfs, resources, process, mounts, patches, network, secrets, and lifecycle options |
| `sandbox_start` | Start stopped sandboxes by name, labels, or status selector |
| `sandbox_list` | List sandboxes with status, image, labels, and timestamps |
| `sandbox_status` | Show status for one sandbox or a filtered sandbox set |
| `sandbox_inspect` | Return full configuration and metadata for one sandbox |
| `sandbox_stop` | Stop selected sandboxes gracefully or forcefully, with optional timeout |
| `sandbox_drain` | Request graceful drain for selected sandboxes |
| `sandbox_wait` | Wait until selected sandboxes reach a terminal state |
| `sandbox_remove` | Remove selected stopped sandboxes, optionally force-stopping running ones first |

**Command Execution**

| Tool | Description |
| ---- | ----------- |
| `sandbox_exec` | Execute an argv command with env, cwd, user, TTY, timeout, rlimits, stdin, and output caps |
| `sandbox_shell` | Execute a shell command string with the same execution controls |
| `sandbox_exec_start` | Start a long-running command and return an in-memory exec session id |
| `sandbox_exec_poll` | Poll output events and exit status for an exec session |
| `sandbox_exec_write_stdin` | Write UTF-8 or base64 data to an exec session stdin |
| `sandbox_exec_signal` | Send `hup`, `int`, `term`, `kill`, or a numeric signal to an exec session |
| `sandbox_exec_close` | Close and forget an exec session |

**Logs**

| Tool | Description |
| ---- | ----------- |
| `sandbox_logs_read` | Read captured logs with tail, time, source, grep, session id, and output cap filters |
| `sandbox_logs_stream` | Poll captured logs using cursors and a bounded follow timeout |

**Filesystem**

| Tool | Description |
| ---- | ----------- |
| `sandbox_fs_read` | Read a sandbox file as UTF-8 text or base64 bytes |
| `sandbox_fs_write` | Write UTF-8 text or base64 bytes to a sandbox file |
| `sandbox_fs_list` | List sandbox directory entries |
| `sandbox_fs_mkdir` | Create a sandbox directory |
| `sandbox_fs_remove` | Remove a sandbox file or directory |
| `sandbox_fs_copy` | Copy a file within one sandbox or between two running sandboxes |
| `sandbox_fs_rename` | Rename a sandbox file or directory |
| `sandbox_fs_stat` | Get sandbox path metadata |
| `sandbox_fs_exists` | Check whether a sandbox path exists |
| `sandbox_fs_copy_from_host` | Copy an allowlisted host path into a sandbox |
| `sandbox_fs_copy_to_host` | Copy a sandbox path to an allowlisted host destination |

**Metrics**

| Tool | Description |
| ---- | ----------- |
| `sandbox_metrics` | Get point-in-time metrics for one running sandbox |
| `sandbox_metrics_all` | Get point-in-time metrics for all running sandboxes |
| `sandbox_metrics_stream` | Collect a bounded number of metrics samples from one sandbox |

**Volumes**

| Tool | Description |
| ---- | ----------- |
| `volume_create` | Create a directory or disk-backed named volume with quota, capacity, and labels |
| `volume_list` | List named volumes with kind, quota, capacity, usage, disk format, labels, and timestamps |
| `volume_inspect` | Inspect one named volume |
| `volume_remove` | Remove one or more named volumes |
| `volume_fs_read` | Read a volume file as UTF-8 text or base64 bytes |
| `volume_fs_write` | Write UTF-8 text or base64 bytes to a volume file |
| `volume_fs_list` | List volume directory entries |
| `volume_fs_mkdir` | Create a directory inside a volume |
| `volume_fs_remove` | Remove a file or directory from a volume |
| `volume_fs_copy` | Copy a file inside a volume |
| `volume_fs_rename` | Rename a file or directory inside a volume |
| `volume_fs_stat` | Get volume path metadata |
| `volume_fs_exists` | Check whether a volume path exists |

**Images**

| Tool | Description |
| ---- | ----------- |
| `image_list` | List cached images |
| `image_inspect` | Inspect cached image config and layers |
| `image_remove` | Remove one or more cached images, optionally forced with confirmation |
| `image_prune` | Remove cached image artifacts unused by sandboxes, with confirmation |

**Snapshots**

| Tool | Description |
| ---- | ----------- |
| `snapshot_create` | Create a snapshot from a stopped sandbox by name or explicit host path |
| `snapshot_list` | List indexed snapshots |
| `snapshot_inspect` | Inspect snapshot metadata by name, digest, or path, optionally verifying integrity |
| `snapshot_verify` | Verify recorded snapshot content integrity |
| `snapshot_remove` | Remove one or more snapshots, optionally forced with confirmation |
| `snapshot_reindex` | Rebuild the local snapshot index |
| `snapshot_export` | Export a snapshot to an allowlisted host archive path |
| `snapshot_import` | Import a snapshot archive from an allowlisted host path |

**SSH and SFTP**

| Tool | Description |
| ---- | ----------- |
| `sandbox_ssh_exec` | Execute a command through the sandbox SSH subsystem |
| `sandbox_sftp_read` | Read a file through sandbox SFTP as UTF-8 text or base64 bytes |
| `sandbox_sftp_write` | Write UTF-8 text or base64 bytes through sandbox SFTP |
| `sandbox_sftp_mkdir` | Create a directory through sandbox SFTP |
| `sandbox_sftp_remove` | Remove a file or directory through sandbox SFTP |
| `sandbox_sftp_rename` | Rename a path through sandbox SFTP |
| `sandbox_sftp_realpath` | Resolve a real path through sandbox SFTP |
| `sandbox_sftp_readlink` | Read a symlink target through sandbox SFTP |
| `sandbox_sftp_symlink` | Create a symlink through sandbox SFTP |

## Resources

| URI | Description |
| --- | ----------- |
| `microsandbox://runtime` | Runtime installation status and MCP configuration |
| `microsandbox://sandboxes` | Current sandbox inventory |
| `microsandbox://volumes` | Current volume inventory |
| `microsandbox://images` | Current image cache inventory |
| `microsandbox://snapshots` | Current snapshot index |
| `microsandbox://schemas/sandbox-create` | JSON Schema for sandbox creation inputs |
| `microsandbox://policy` | Effective host path and dangerous-operation policy |

## Configuration

| Env var | Default | Description |
| ------- | ------- | ----------- |
| `MICROSANDBOX_MCP_HOST_PATHS` | current working directory | Colon-separated allowlist for bind mounts, host copy, snapshot import/export, and other host path operations |
| `MICROSANDBOX_MCP_HOST_PATH_POLICY` | `allowlist` | Set to `unrestricted` to allow any host path |
| `MICROSANDBOX_MCP_ENABLE_DANGEROUS` | `0` | Enables future dangerous operations; destructive cache operations still require explicit `confirm: true` |
| `MICROSANDBOX_MCP_MAX_OUTPUT_BYTES` | `1048576` | Default cap for command output, logs, and file reads |
| `MICROSANDBOX_MCP_DEFAULT_TIMEOUT_MS` | `120000` | Default timeout budget for exec-style operations |
| `MICROSANDBOX_MCP_SESSION_TTL_MS` | `900000` | Idle TTL for in-memory exec sessions |
| `MSB_PATH` | unset | Optional path to the `msb` binary for SDK/runtime discovery |
| `MSB_LIBKRUNFW_PATH` | unset | Optional path to `libkrunfw` |

## SDK Gaps

The server intentionally stays a thin TypeScript SDK adapter and does not shell out to `msb` for core behavior. Image pull/load/save, persistent registry login/logout/list, SSH authorization management, and managed SSH serving are not exposed until the TypeScript SDK provides first-class APIs for them. Command aliases (`msb install`/`msb uninstall`) and runtime self-update/uninstall are intentionally out of scope.

## Requirements

macOS (Apple Silicon) or Linux (x86_64/ARM64 with KVM support).

Use `runtime_check` to verify whether `msb` and `libkrunfw` are available. Use `runtime_install` to install them from the MCP server. If that fails, install manually:

```bash
curl -fsSL https://install.microsandbox.dev | sh
```

## Development

```bash
git clone https://github.com/superradcompany/microsandbox-mcp.git
cd microsandbox-mcp
npm install
npm run build
npm test
npm run test:e2e
node dist/index.js
```

`npm run test:e2e` launches the built MCP server over stdio and calls every registered tool and resource with live parameters. It creates temporary sandboxes, volumes, snapshots, and host files, then cleans them up. Global image cache deletion is guarded by default; set `MICROSANDBOX_MCP_E2E_DESTRUCTIVE_CACHE=1` to let the e2e script run destructive image prune behavior instead of the safe confirmation-error path.

## Links

- [microsandbox](https://github.com/microsandbox/microsandbox) — The microVM sandbox runtime
- [Documentation](https://docs.microsandbox.dev) — Guides and API reference
- [Agent Skills](https://github.com/superradcompany/skills) — Teach agents to use microsandbox without MCP

## License

Apache-2.0
