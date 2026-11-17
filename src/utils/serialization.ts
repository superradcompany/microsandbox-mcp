import type {
  FsEntry,
  FsMetadata,
  ImageDetail,
  ImageHandle,
  LogEntry,
  SandboxMetrics,
} from "microsandbox";
import type { Volume, Snapshot as SdkSnapshot } from "microsandbox";
import { observation, type SandboxHandle } from "./sdk-compat.js";
import type { Snapshot } from "./snapshot-api.js";

export async function sandboxHandleData(handle: SandboxHandle): Promise<Record<string, unknown>> {
  const current = typeof Reflect.get(handle, "info") === "function";
  const info: object = current ? await observation<Record<string, unknown>>(handle, "info") : handle;
  return {
    name: handle.name,
    status: Reflect.get(info, "status"),
    config: current ? await observation(handle, "config") : parseJson(Reflect.get(handle, "configJson")),
    createdAt: toIso(Reflect.get(info, "createdAt")),
    updatedAt: toIso(Reflect.get(info, "updatedAt")),
  };
}

export async function sandboxSummaryData(handle: SandboxHandle): Promise<Record<string, unknown>> {
  const data = await sandboxHandleData(handle);
  const config = data.config as Record<string, unknown> | null;
  return {
    name: data.name,
    status: data.status,
    image: imageFromConfig(config),
    labels: labelsFromConfig(config),
    createdAt: data.createdAt,
    updatedAt: data.updatedAt,
  };
}

export function metricsData(metrics: SandboxMetrics): Record<string, unknown> {
  return {
    timestamp: toIso(metrics.timestamp),
    cpuPercent: metrics.cpuPercent,
    vcpuTimeNs: metrics.vcpuTimeNs,
    memoryBytes: metrics.memoryBytes,
    memoryAvailableBytes: metrics.memoryAvailableBytes,
    memoryHostResidentBytes: metrics.memoryHostResidentBytes,
    memoryLimitBytes: metrics.memoryLimitBytes,
    diskReadBytes: metrics.diskReadBytes,
    diskWriteBytes: metrics.diskWriteBytes,
    netRxBytes: metrics.netRxBytes,
    netTxBytes: metrics.netTxBytes,
    uptimeMs: metrics.uptimeMs,
    uptimeSecs: Math.round(metrics.uptimeMs / 1000),
  };
}

export function fsEntryData(entry: FsEntry): Record<string, unknown> {
  return {
    path: entry.path,
    kind: entry.kind,
    size: entry.size,
    mode: entry.mode,
    modified: toIso(entry.modified),
  };
}

export function fsMetadataData(meta: FsMetadata): Record<string, unknown> {
  return {
    kind: meta.kind,
    size: meta.size,
    mode: meta.mode,
    readonly: meta.readonly,
    modified: toIso(meta.modified),
    created: toIso(meta.created),
  };
}

export function logEntryData(entry: LogEntry): Record<string, unknown> {
  return {
    timestamp: toIso(entry.timestamp),
    source: entry.source,
    sessionId: entry.sessionId,
    text: entry.text(),
    cursor: entry.cursor,
  };
}

export function imageHandleData(handle: ImageHandle): Record<string, unknown> {
  return {
    reference: handle.reference,
    sizeBytes: handle.sizeBytes,
    manifestDigest: handle.manifestDigest,
    architecture: handle.architecture,
    os: handle.os,
    layerCount: handle.layerCount,
    lastUsedAt: toIso(handle.lastUsedAt),
    createdAt: toIso(handle.createdAt),
  };
}

export function imageDetailData(detail: ImageDetail): Record<string, unknown> {
  return {
    handle: imageHandleData(detail.handle),
    config: detail.config,
    layers: detail.layers,
  };
}

export async function volumeHandleData(volume: Awaited<ReturnType<typeof Volume.get>>): Promise<Record<string, unknown>> {
  const handle = typeof Reflect.get(volume, "info") === "function"
    ? await observation<object>(volume, "info") : volume;
  return {
    name: Reflect.get(handle, "name"),
    kind: Reflect.get(handle, "kind"),
    quotaMib: Reflect.get(handle, "quotaMib"),
    usedBytes: Reflect.get(handle, "usedBytes"),
    capacityBytes: Reflect.get(handle, "capacityBytes"),
    diskFormat: Reflect.get(handle, "diskFormat"),
    diskFstype: Reflect.get(handle, "diskFstype"),
    labels: Object.fromEntries(Reflect.get(handle, "labels")),
    createdAt: toIso(Reflect.get(handle, "createdAt")),
  };
}

export function snapshotHandleData(handle: Awaited<ReturnType<typeof SdkSnapshot.get>>): Record<string, unknown> {
  return {
    reference: handle.reference,
    referenceKind: handle.referenceKind,
    path: handle.referenceKind === "path" ? handle.reference : null,
    digest: handle.digest,
    name: handle.name,
    parentDigest: handle.parentDigest,
    scope: handle.scope,
    imageRef: handle.imageRef,
    format: handle.format,
    sizeBytes: bigintToString(handle.sizeBytes),
    createdAt: toIso(handle.createdAt),
  };
}

export async function snapshotData(snapshot: Snapshot): Promise<Record<string, unknown>> {
  return {
    reference: snapshot.reference,
    referenceKind: snapshot.referenceKind,
    path: snapshot.referenceKind === "path" ? snapshot.reference : null,
    digest: snapshot.digest,
    sizeBytes: bigintToString(snapshot.sizeBytes),
    imageRef: snapshot.imageRef,
    imageManifestDigest: await observation(snapshot, "imageManifestDigest"),
    scope: snapshot.scope,
    format: snapshot.format,
    fstype: snapshot.fstype,
    parent: snapshot.parent,
    createdAt: snapshot.createdAt,
    labels: Object.fromEntries(await observation<ReadonlyArray<readonly [string, string]>>(snapshot, "labels")),
    sourceSandbox: await observation(snapshot, "sourceSandbox"),
  };
}

export function toIso(value: Date | number | string | null | undefined): string | null {
  if (value == null) return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "number") return new Date(value).toISOString();
  return value;
}

export function parseDate(value: string | undefined): Date | undefined {
  if (!value) return undefined;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`invalid date: ${value}`);
  }
  return date;
}

export function parseJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function bigintToString(value: bigint | null): string | null {
  return value == null ? null : value.toString();
}

function imageFromConfig(config: Record<string, unknown> | null): unknown {
  if (!config || typeof config.image !== "object" || config.image === null) return null;
  return config.image;
}

function labelsFromConfig(config: Record<string, unknown> | null): unknown {
  if (!config || typeof config.labels !== "object" || config.labels === null) return {};
  return config.labels;
}
