import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerResources } from "./resources.js";
import { registerSandboxTools } from "./tools/sandbox.js";
import { registerExecTools } from "./tools/exec.js";
import { registerFilesystemTools } from "./tools/filesystem.js";
import { registerImageTools } from "./tools/image.js";
import { registerLogTools } from "./tools/logs.js";
import { registerVolumeTools } from "./tools/volume.js";
import { registerMetricsTools } from "./tools/metrics.js";
import { registerRuntimeTools } from "./tools/runtime.js";
import { registerSnapshotTools } from "./tools/snapshot.js";
import { registerSshTools } from "./tools/ssh.js";

const server = new McpServer({
  name: "microsandbox",
  version: "0.5.11",
});

registerResources(server);
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

const transport = new StdioServerTransport();
await server.connect(transport);
