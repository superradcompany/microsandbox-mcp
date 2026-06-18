import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { Sandbox, type SandboxHandle } from "microsandbox";

import { formatError } from "../utils/errors.js";
import { formatExecOutput } from "../utils/exec-output.js";
import { assertHostPathAllowed } from "../utils/policy.js";
import { ok } from "../utils/response.js";
import { sandboxHandleData, sandboxSummaryData } from "../utils/serialization.js";

const statusSchema = z.enum(["running", "stopped", "crashed", "draining", "all"]);

const selectorSchema = z.object({
  name: z.string().optional().describe("Sandbox name"),
  names: z.array(z.string()).optional().describe("Sandbox names"),
  labels: z.record(z.string(), z.string()).optional().describe("AND-matched labels"),
  status: statusSchema.optional().describe("Status filter"),
});

const mountSchema = z.object({
  kind: z.enum(["bind", "named", "tmpfs", "disk"]),
  guestPath: z.string(),
  hostPath: z.string().optional(),
  name: z.string().optional(),
  source: z.string().optional(),
  readonly: z.boolean().optional(),
  noexec: z.boolean().optional(),
  nosuid: z.boolean().optional(),
  nodev: z.boolean().optional(),
  sizeMib: z.number().int().positive().optional(),
  format: z.enum(["raw", "qcow2", "vmdk"]).optional(),
  fstype: z.string().optional(),
  statVirtualization: z.enum(["strict", "relaxed", "off"]).optional(),
  hostPermissions: z.enum(["private", "mirror"]).optional(),
});

const patchSchema = z.object({
  kind: z.enum(["text", "file", "copyFile", "copyDir", "mkdir", "append", "remove", "symlink"]),
  type: z.enum(["text", "file", "copyFile", "copyDir", "mkdir", "append", "remove", "symlink"]).optional(),
  path: z.string().optional(),
  guestPath: z.string().optional(),
  hostPath: z.string().optional(),
  content: z.string().optional(),
  contentBase64: z.string().optional(),
  target: z.string().optional(),
  linkPath: z.string().optional(),
  mode: z.number().int().optional(),
  replace: z.boolean().optional(),
});

const rootfsSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("oci"),
    reference: z.string(),
    pullPolicy: z.enum(["always", "if-missing", "never"]).optional(),
    upperSizeMib: z.number().int().positive().optional(),
    registry: z.object({
      insecure: z.boolean().optional(),
      caCertsPath: z.string().optional(),
      auth: z.object({
        kind: z.enum(["anonymous", "basic"]),
        username: z.string().optional(),
        password: z.string().optional(),
      }).optional(),
    }).optional(),
  }),
  z.object({ kind: z.literal("bind"), path: z.string() }),
  z.object({
    kind: z.literal("disk"),
    path: z.string(),
    fstype: z.string().optional(),
  }),
  z.object({ kind: z.literal("snapshot"), pathOrName: z.string() }),
]);

export const sandboxCreateSchema = z.object({
  name: z.string().optional(),
  image: z.string().optional().describe("Convenience OCI image or local rootfs path"),
  rootfs: rootfsSchema.optional(),
  cpus: z.number().int().min(1).max(16).optional(),
  memoryMib: z.number().int().min(128).optional(),
  workdir: z.string().optional(),
  env: z.record(z.string(), z.string()).optional(),
  volumes: z.array(mountSchema).optional(),
  mounts: z.array(mountSchema).optional(),
  patches: z.array(patchSchema).optional(),
  entrypoint: z.array(z.string()).optional(),
  hostname: z.string().optional(),
  maxDuration: z.number().int().positive().optional(),
  idleTimeout: z.number().int().positive().optional(),
  resources: z.object({
    cpus: z.number().int().min(1).max(16).optional(),
    memoryMib: z.number().int().min(128).optional(),
  }).optional(),
  process: z.object({
    workdir: z.string().optional(),
    shell: z.string().optional(),
    env: z.record(z.string(), z.string()).optional(),
    labels: z.record(z.string(), z.string()).optional(),
    entrypoint: z.array(z.string()).optional(),
    user: z.string().optional(),
    scripts: z.record(z.string(), z.string()).optional(),
    rlimits: z.array(z.object({
      resource: z.string(),
      soft: z.number().int().nonnegative(),
      hard: z.number().int().nonnegative().optional(),
    })).optional(),
    init: z.object({
      path: z.string(),
      args: z.array(z.string()).optional(),
      env: z.record(z.string(), z.string()).optional(),
    }).optional(),
  }).optional(),
  lifecycle: z.object({
    detached: z.boolean().optional(),
    replace: z.boolean().optional(),
    replaceTimeoutMs: z.number().int().nonnegative().optional(),
    maxDurationSecs: z.number().int().positive().optional(),
    idleTimeoutSecs: z.number().int().positive().optional(),
    logLevel: z.enum(["error", "warn", "info", "debug", "trace"]).optional(),
    metricsSampleIntervalMs: z.number().int().nonnegative().optional(),
    disableMetricsSample: z.boolean().optional(),
    quietLogs: z.boolean().optional(),
  }).optional(),
  network: z.object({
    disabled: z.boolean().optional(),
    ports: z.array(z.object({
      hostPort: z.number().int().min(1).max(65535),
      guestPort: z.number().int().min(1).max(65535),
      bindAddress: z.string().optional(),
      protocol: z.enum(["tcp", "udp"]).optional(),
    })).optional(),
    maxConnections: z.number().int().positive().optional(),
    trustHostCas: z.boolean().optional(),
    ipv4Pool: z.string().optional(),
    ipv6Pool: z.string().optional(),
    dns: z.object({
      allowRebind: z.boolean().optional(),
      nameservers: z.array(z.string()).optional(),
      queryTimeoutMs: z.number().int().positive().optional(),
    }).optional(),
    tls: z.object({
      ports: z.array(z.number().int().min(1).max(65535)).optional(),
      bypassDomains: z.array(z.string()).optional(),
      blockQuic: z.boolean().optional(),
      caCertPath: z.string().optional(),
      caKeyPath: z.string().optional(),
      upstreamCaCertPaths: z.array(z.string()).optional(),
      trustHostCas: z.boolean().optional(),
    }).optional(),
  }).optional(),
  secrets: z.array(z.object({
    envVar: z.string(),
    value: z.string().optional(),
    valueEnv: z.string().optional(),
    allowedHost: z.string(),
  })).optional(),
});

const createSchema = sandboxCreateSchema;

export function registerSandboxTools(server: McpServer): void {
  server.registerTool(
    "sandbox_run",
    {
      title: "Run Command in Ephemeral Sandbox",
      description: "Create an ephemeral sandbox, run a shell command, return output, and destroy it.",
      inputSchema: createSchema.extend({
        command: z.string().describe("Shell command to execute"),
      }),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
      },
    },
    async (args) => {
      const name = args.name ?? `mcp-run-${Date.now()}`;
      let sandbox: Awaited<ReturnType<ReturnType<typeof Sandbox.builder>["create"]>> | undefined;
      try {
        const builder = buildSandbox(name, args, false);
        sandbox = await builder.create();
        const output = await sandbox.shell(args.command);
        const result = formatExecOutput(output);
        return ok({ name, ...result.data }, { truncated: result.truncated });
      } catch (error) {
        return formatError(error);
      } finally {
        if (sandbox) {
          try {
            await sandbox.stop();
            await waitForStopped(name);
            await Sandbox.remove(name);
          } catch {
            // Best-effort cleanup.
          }
        }
      }
    },
  );

  server.registerTool(
    "sandbox_create",
    {
      title: "Create Sandbox",
      description: "Create and boot a persistent named sandbox.",
      inputSchema: createSchema.extend({
        name: z.string().describe("Unique sandbox name"),
      }),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
      },
    },
    async (args) => {
      try {
        const builder = buildSandbox(args.name, args, true);
        const sandbox = await builder.create();
        if (args.lifecycle?.detached !== false) {
          await sandbox.detach();
        }
        return ok({ name: args.name, status: "running" });
      } catch (error) {
        return formatError(error);
      }
    },
  );

  server.registerTool(
    "sandbox_start",
    {
      title: "Start Sandboxes",
      description: "Start stopped sandboxes by name or selector.",
      inputSchema: selectorSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
      },
    },
    async (selector) => {
      try {
        const handles = await resolveSandboxHandles(selector, { requireSelector: true });
        const results = [];
        for (const handle of handles) {
          if (handle.status === "running") {
            results.push({ name: handle.name, started: false, alreadyRunning: true });
            continue;
          }
          const sandbox = await handle.startDetached();
          await sandbox.detach();
          results.push({ name: handle.name, started: true });
        }
        return ok(results);
      } catch (error) {
        return formatError(error);
      }
    },
  );

  server.registerTool(
    "sandbox_list",
    {
      title: "List Sandboxes",
      description: "List sandboxes with status and summary metadata.",
      inputSchema: selectorSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
      },
    },
    async (selector) => {
      try {
        const handles = await resolveSandboxHandles(selector, { defaultAll: true });
        return ok(handles.map(sandboxSummaryData));
      } catch (error) {
        return formatError(error);
      }
    },
  );

  server.registerTool(
    "sandbox_status",
    {
      title: "Sandbox Status",
      description: "Show status for one sandbox or a filtered sandbox set.",
      inputSchema: selectorSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
      },
    },
    async (selector) => {
      try {
        const status = selector.status ?? (selector.name || selector.names ? "all" : "running");
        const handles = await resolveSandboxHandles({ ...selector, status }, { defaultAll: true });
        return ok(handles.map(sandboxSummaryData));
      } catch (error) {
        return formatError(error);
      }
    },
  );

  server.registerTool(
    "sandbox_inspect",
    {
      title: "Inspect Sandbox",
      description: "Get detailed information about a specific sandbox including full configuration.",
      inputSchema: z.object({
        name: z.string().describe("Sandbox name"),
      }),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
      },
    },
    async ({ name }) => {
      try {
        const handle = await Sandbox.get(name);
        return ok(sandboxHandleData(handle));
      } catch (error) {
        return formatError(error);
      }
    },
  );

  server.registerTool(
    "sandbox_stop",
    {
      title: "Stop Sandboxes",
      description: "Stop running sandboxes gracefully or forcefully.",
      inputSchema: selectorSchema.extend({
        force: z.boolean().optional(),
        timeoutMs: z.number().int().nonnegative().optional(),
      }),
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
      },
    },
    async ({ force, timeoutMs, ...selector }) => {
      try {
        const handles = await resolveSandboxHandles(selector, { requireSelector: true });
        const results = [];
        for (const handle of handles) {
          if (handle.status !== "running") {
            results.push({ name: handle.name, stopped: false, alreadyStopped: true, status: handle.status });
            continue;
          }
          if (force) {
            if (typeof timeoutMs === "number") await handle.killWithTimeout(timeoutMs);
            else await handle.kill();
          } else if (typeof timeoutMs === "number") {
            await handle.stopWithTimeout(timeoutMs);
          } else {
            await handle.stop();
          }
          results.push({ name: handle.name, stopped: true });
        }
        return ok(results);
      } catch (error) {
        return formatError(error);
      }
    },
  );

  server.registerTool(
    "sandbox_drain",
    {
      title: "Drain Sandboxes",
      description: "Request graceful drain for running sandboxes.",
      inputSchema: selectorSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
      },
    },
    async (selector) => {
      try {
        const handles = await resolveSandboxHandles(selector, { requireSelector: true });
        const results = [];
        for (const handle of handles) {
          if (handle.status !== "running") {
            results.push({ name: handle.name, drainRequested: false, status: handle.status });
            continue;
          }
          await handle.requestDrain();
          results.push({ name: handle.name, drainRequested: true });
        }
        return ok(results);
      } catch (error) {
        return formatError(error);
      }
    },
  );

  server.registerTool(
    "sandbox_wait",
    {
      title: "Wait For Sandboxes",
      description: "Wait until selected sandboxes reach a terminal state.",
      inputSchema: selectorSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
      },
    },
    async (selector) => {
      try {
        const handles = await resolveSandboxHandles(selector, { requireSelector: true });
        const results = [];
        for (const handle of handles) {
          results.push(await handle.waitUntilStopped());
        }
        return ok(results);
      } catch (error) {
        return formatError(error);
      }
    },
  );

  server.registerTool(
    "sandbox_remove",
    {
      title: "Remove Sandboxes",
      description: "Remove stopped sandboxes. Use force to stop running sandboxes first.",
      inputSchema: selectorSchema.extend({
        force: z.boolean().optional(),
      }),
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
      },
    },
    async ({ force, ...selector }) => {
      try {
        const handles = await resolveSandboxHandles(selector, { requireSelector: true });
        const results = [];
        for (const handle of handles) {
          if (force && handle.status === "running") {
            await handle.kill();
          }
          await Sandbox.remove(handle.name);
          results.push({ name: handle.name, removed: true });
        }
        return ok(results);
      } catch (error) {
        return formatError(error);
      }
    },
  );
}

async function waitForStopped(name: string, timeoutMs = 10000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const h = await Sandbox.get(name);
      if (h.status !== "running") return;
    } catch {
      return;
    }
    await new Promise((r) => setTimeout(r, 200));
  }
}

function buildSandbox(name: string, args: z.infer<typeof createSchema>, persistent: boolean) {
  let builder = Sandbox.builder(name);
  builder = applyRootfs(builder, args);

  const cpus = args.resources?.cpus ?? args.cpus;
  const memoryMib = args.resources?.memoryMib ?? args.memoryMib;
  const workdir = args.process?.workdir ?? args.workdir;
  const env = { ...(args.env ?? {}), ...(args.process?.env ?? {}) };
  const entrypoint = args.process?.entrypoint ?? args.entrypoint;
  const maxDuration = args.lifecycle?.maxDurationSecs ?? args.maxDuration;
  const idleTimeout = args.lifecycle?.idleTimeoutSecs ?? args.idleTimeout;

  if (cpus) builder = builder.cpus(cpus);
  if (memoryMib) builder = builder.memory(memoryMib);
  if (workdir) builder = builder.workdir(workdir);
  if (args.process?.shell) builder = builder.shell(args.process.shell);
  if (Object.keys(env).length > 0) builder = builder.envs(env);
  if (args.process?.labels) builder = builder.labels(args.process.labels);
  if (entrypoint) builder = builder.entrypoint(entrypoint);
  if (args.hostname) builder = builder.hostname(args.hostname);
  if (args.process?.user) builder = builder.user(args.process.user);
  if (args.process?.scripts) builder = builder.scripts(args.process.scripts);
  if (maxDuration) builder = builder.maxDuration(maxDuration);
  if (idleTimeout) builder = builder.idleTimeout(idleTimeout);

  if (args.lifecycle?.replaceTimeoutMs !== undefined) builder = builder.replaceWithTimeout(args.lifecycle.replaceTimeoutMs);
  else if (args.lifecycle?.replace) builder = builder.replace();
  if (args.lifecycle?.logLevel) builder = builder.logLevel(args.lifecycle.logLevel);
  if (args.lifecycle?.metricsSampleIntervalMs !== undefined) builder = builder.metricsSampleIntervalMs(args.lifecycle.metricsSampleIntervalMs);
  if (args.lifecycle?.disableMetricsSample) builder = builder.disableMetricsSample();
  if (args.lifecycle?.quietLogs) builder = builder.quietLogs();
  builder = builder.detached(args.lifecycle?.detached ?? persistent);

  if (args.process?.init) {
    const init = args.process.init;
    if (init.env && Object.keys(init.env).length > 0) {
      builder = builder.initWith(init.path, (b) => {
        let acc = init.args ? b.args(init.args) : b;
        acc = acc.envs(init.env!);
        return acc;
      });
    } else {
      builder = builder.init(init.path, init.args);
    }
  }

  for (const rlimit of args.process?.rlimits ?? []) {
    builder = builder.rlimitRange(rlimit.resource, rlimit.soft, rlimit.hard ?? rlimit.soft);
  }

  for (const mount of [...(args.volumes ?? []), ...(args.mounts ?? [])]) {
    builder = applyMount(builder, mount);
  }

  if (args.patches && args.patches.length > 0) {
    builder = builder.patch((p) => {
      let acc = p;
      for (const patch of args.patches ?? []) {
        const kind = patch.kind ?? patch.type;
        switch (kind) {
          case "text":
            acc = acc.text(requiredPath(patch), patch.content ?? "", { mode: patch.mode, replace: patch.replace });
            break;
          case "file":
            acc = acc.file(requiredPath(patch), Buffer.from(patch.contentBase64 ?? "", "base64"), { mode: patch.mode, replace: patch.replace });
            break;
          case "copyFile":
            acc = acc.copyFile(assertHostPathAllowed(requiredHostPath(patch)), requiredGuestPath(patch), { mode: patch.mode, replace: patch.replace });
            break;
          case "copyDir":
            acc = acc.copyDir(assertHostPathAllowed(requiredHostPath(patch)), requiredGuestPath(patch), { replace: patch.replace });
            break;
          case "mkdir":
            acc = acc.mkdir(requiredPath(patch), { mode: patch.mode });
            break;
          case "append":
            acc = acc.append(requiredPath(patch), patch.content ?? "");
            break;
          case "remove":
            acc = acc.remove(requiredPath(patch));
            break;
          case "symlink":
            acc = acc.symlink(patch.target ?? "", patch.linkPath ?? requiredPath(patch), { replace: patch.replace });
            break;
        }
      }
      return acc;
    });
  }

  if (args.network || args.secrets) {
    builder = builder.network((n) => {
      let acc = n;
      if (args.network?.disabled) acc = acc.enabled(false);
      for (const port of args.network?.ports ?? []) {
        const protocol = port.protocol ?? "tcp";
        if (protocol === "udp" && port.bindAddress) acc = acc.portUdpBind(port.bindAddress, port.hostPort, port.guestPort);
        else if (protocol === "udp") acc = acc.portUdp(port.hostPort, port.guestPort);
        else if (port.bindAddress) acc = acc.portBind(port.bindAddress, port.hostPort, port.guestPort);
        else acc = acc.port(port.hostPort, port.guestPort);
      }
      if (args.network?.maxConnections) acc = acc.maxConnections(args.network.maxConnections);
      if (args.network?.trustHostCas || args.network?.tls?.trustHostCas) acc = acc.trustHostCAs(true);
      if (args.network?.ipv4Pool) acc = acc.ipv4Pool(args.network.ipv4Pool);
      if (args.network?.ipv6Pool) acc = acc.ipv6Pool(args.network.ipv6Pool);
      if (args.network?.dns) {
        const dns = args.network.dns;
        acc = acc.dns((b: any) => {
          let next = b;
          if (dns.allowRebind !== undefined) next = next.rebindProtection(!dns.allowRebind);
          if (dns.nameservers) next = next.nameservers(dns.nameservers);
          if (dns.queryTimeoutMs) next = next.queryTimeoutMs(dns.queryTimeoutMs);
          return next;
        });
      }
      if (args.network?.tls) {
        const tls = args.network.tls;
        acc = acc.tls((b: any) => {
          let next = b;
          for (const bypass of tls.bypassDomains ?? []) next = next.bypass(bypass);
          if (tls.ports) next = next.interceptedPorts(tls.ports);
          if (tls.blockQuic !== undefined) next = next.blockQuic(tls.blockQuic);
          if (tls.caCertPath) next = next.interceptCaCert(assertHostPathAllowed(tls.caCertPath));
          if (tls.caKeyPath) next = next.interceptCaKey(assertHostPathAllowed(tls.caKeyPath));
          for (const ca of tls.upstreamCaCertPaths ?? []) next = next.upstreamCaCert(assertHostPathAllowed(ca));
          return next;
        });
      }
      for (const secret of args.secrets ?? []) {
        const value = secret.value ?? (secret.valueEnv ? process.env[secret.valueEnv] : undefined);
        if (value === undefined) throw new Error(`missing secret value for ${secret.envVar}`);
        acc = acc.secretEnvSimple(secret.envVar, value, secret.allowedHost);
      }
      return acc;
    });
  }

  return builder;
}

function applyRootfs(builder: ReturnType<typeof Sandbox.builder>, args: z.infer<typeof createSchema>) {
  const rootfs = args.rootfs;
  if (rootfs) {
    switch (rootfs.kind) {
      case "oci":
        builder = builder.imageWith((image) => {
          let acc = image.oci(rootfs.reference);
          if (rootfs.upperSizeMib) acc = acc.upperSize(rootfs.upperSizeMib);
          return acc;
        });
        if (rootfs.pullPolicy) builder = builder.pullPolicy(rootfs.pullPolicy);
        if (rootfs.registry) {
          const registry = rootfs.registry;
          builder = builder.registry((r) => {
            let acc = r;
            if (registry.insecure) acc = acc.insecure();
            if (registry.caCertsPath) acc = acc.caCertsPath(assertHostPathAllowed(registry.caCertsPath));
            if (registry.auth) acc = acc.auth(registry.auth);
            return acc;
          });
        }
        return builder;
      case "bind":
        return builder.image(assertHostPathAllowed(rootfs.path));
      case "disk":
        return builder.imageWith((image) => {
          let acc = image.disk(assertHostPathAllowed(rootfs.path));
          if (rootfs.fstype) acc = acc.fstype(rootfs.fstype);
          return acc;
        });
      case "snapshot":
        return builder.fromSnapshot(resolvePathOrName(rootfs.pathOrName));
    }
  }

  if (!args.image) throw new Error("sandbox_create requires rootfs or image");
  return builder.image(resolvePathOrName(args.image));
}

function applyMount(builder: ReturnType<typeof Sandbox.builder>, mount: z.infer<typeof mountSchema>) {
  return builder.volume(mount.guestPath, (m) => {
    let acc = m;
    switch (mount.kind) {
      case "bind":
        acc = acc.bind(assertHostPathAllowed(mount.hostPath ?? mount.source ?? ""));
        break;
      case "named":
        acc = acc.named(mount.name ?? mount.source ?? "");
        break;
      case "tmpfs":
        acc = acc.tmpfs();
        if (mount.sizeMib) acc = acc.size(mount.sizeMib);
        break;
      case "disk":
        acc = acc.disk(assertHostPathAllowed(mount.hostPath ?? mount.source ?? ""));
        if (mount.format) acc = acc.format(mount.format);
        if (mount.fstype) acc = acc.fstype(mount.fstype);
        break;
    }
    if (mount.readonly) acc = acc.readonly();
    if (mount.noexec) acc = acc.noexec();
    if (mount.nosuid) acc = acc.nosuid();
    if (mount.nodev) acc = acc.nodev();
    if (mount.statVirtualization) acc = acc.statVirtualization(mount.statVirtualization);
    if (mount.hostPermissions) acc = acc.hostPermissions(mount.hostPermissions);
    return acc;
  });
}

async function resolveSandboxHandles(
  selector: z.infer<typeof selectorSchema>,
  options: { requireSelector?: boolean; defaultAll?: boolean } = {},
): Promise<SandboxHandle[]> {
  const names = [...(selector.name ? [selector.name] : []), ...(selector.names ?? [])];
  const hasSelector = names.length > 0 || Object.keys(selector.labels ?? {}).length > 0 || selector.status !== undefined;
  if (options.requireSelector && !hasSelector) throw new Error("at least one selector is required");

  const map = new Map<string, SandboxHandle>();
  for (const name of names) {
    const handle = await Sandbox.get(name);
    map.set(handle.name, handle);
  }

  if (Object.keys(selector.labels ?? {}).length > 0) {
    for (const handle of await Sandbox.listWith({ labels: selector.labels })) {
      map.set(handle.name, handle);
    }
  } else if (names.length === 0 && (selector.status !== undefined || options.defaultAll)) {
    for (const handle of await Sandbox.list()) {
      map.set(handle.name, handle);
    }
  }

  let handles = [...map.values()];
  if (selector.status && selector.status !== "all") {
    handles = handles.filter((handle) => handle.status === selector.status);
  }
  handles.sort((left, right) => left.name.localeCompare(right.name));
  return handles;
}

function resolvePathOrName(value: string): string {
  return looksLikePath(value) ? assertHostPathAllowed(value) : value;
}

function looksLikePath(value: string): boolean {
  return value.startsWith("/") || value.startsWith("./") || value.startsWith("../") || value.startsWith("~");
}

function requiredPath(patch: z.infer<typeof patchSchema>): string {
  const path = patch.path ?? patch.guestPath;
  if (!path) throw new Error(`${patch.kind} patch requires path`);
  return path;
}

function requiredGuestPath(patch: z.infer<typeof patchSchema>): string {
  const path = patch.guestPath ?? patch.path;
  if (!path) throw new Error(`${patch.kind} patch requires guestPath`);
  return path;
}

function requiredHostPath(patch: z.infer<typeof patchSchema>): string {
  if (!patch.hostPath) throw new Error(`${patch.kind} patch requires hostPath`);
  return patch.hostPath;
}
