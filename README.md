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

**Sandbox Lifecycle:**
| Tool | Description |
| ---- | ----------- |
| `sandbox_run` | Create an ephemeral sandbox, run a command, return the output, and destroy it |
| `sandbox_create` | Create and boot a persistent named sandbox with full configuration |
| `sandbox_list` | List all sandboxes with their current status |
| `sandbox_inspect` | Get detailed sandbox information including full configuration |
| `sandbox_stop` | Stop a running sandbox (graceful SIGTERM or force SIGKILL) |
| `sandbox_remove` | Remove a stopped sandbox |

**Command Execution:**
| Tool | Description |
| ---- | ----------- |
| `sandbox_exec` | Execute a command with arguments inside a running sandbox |
| `sandbox_shell` | Execute a shell command string with pipes, redirects, and shell syntax |

**Filesystem:**
| Tool | Description |
| ---- | ----------- |
| `sandbox_fs_read` | Read a file from the sandbox filesystem |
| `sandbox_fs_write` | Write content to a file inside the sandbox |
| `sandbox_fs_list` | List directory contents |
| `sandbox_fs_mkdir` | Create a directory with parent directories |
| `sandbox_fs_remove` | Remove a file or directory |
| `sandbox_fs_stat` | Get file metadata (kind, size, mode, modified time) |

**Volume Management:**
| Tool | Description |
| ---- | ----------- |
| `volume_create` | Create a named persistent volume that survives sandbox restarts |
| `volume_list` | List all volumes |
| `volume_remove` | Remove a named volume |

**Monitoring:**
| Tool | Description |
| ---- | ----------- |
| `sandbox_metrics` | Get live CPU, memory, disk I/O, and network metrics |
| `check_installed` | Verify that the msb runtime and libkrunfw are available |

## Requirements

macOS (Apple Silicon) or Linux (x86_64/ARM64 with KVM support).

The `msb` runtime and `libkrunfw` are installed automatically on first run. If that fails, install manually:

```bash
curl -fsSL https://install.microsandbox.dev | sh
```

## Development

```bash
git clone https://github.com/superradcompany/microsandbox-mcp.git
cd microsandbox-mcp
npm install
npm run build
node dist/index.js
```

## Links

- [microsandbox](https://github.com/microsandbox/microsandbox) — The microVM sandbox runtime
- [Documentation](https://docs.microsandbox.dev) — Guides and API reference
- [Agent Skills](https://github.com/superradcompany/skills) — Teach agents to use microsandbox without MCP

## License

Apache-2.0
