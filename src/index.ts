import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerSandboxTools } from "./tools/sandbox.js";
import { registerExecTools } from "./tools/exec.js";
import { registerFilesystemTools } from "./tools/filesystem.js";
import { registerVolumeTools } from "./tools/volume.js";
import { registerMetricsTools } from "./tools/metrics.js";

const server = new McpServer({
  name: "microsandbox",
  version: "0.3.13",
});

registerSandboxTools(server);
registerExecTools(server);
registerFilesystemTools(server);
registerVolumeTools(server);
registerMetricsTools(server);

const transport = new StdioServerTransport();
await server.connect(transport);
