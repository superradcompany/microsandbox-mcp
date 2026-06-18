import type {
  FsEntry,
  FsMetadata,
  ImageDetail,
  ImageHandle,
  LogEntry,
  SandboxHandle,
  SandboxMetrics,
  Snapshot,
  SnapshotHandle,
  VolumeHandle,
} from "microsandbox";

export function sandboxHandleData(handle: SandboxHandle): Record<string, unknown> {
  return {
    name: handle.name,
    status: handle.status,
    config: parseJson(handle.configJson),
    createdAt: toIso(handle.createdAt),
    updatedAt: toIso(handle.updatedAt),
  };
}

export function sandboxSummaryData(handle: SandboxHandle): Record<string, unknown> {
  const config = parseJson(handle.configJson) as Record<string, unknown> | null;
  return {
    name: handle.name,
    status: handle.status,
    image: imageFromConfig(config),
    labels: labelsFromConfig(config),
    createdAt: toIso(handle.createdAt),
    updatedAt: toIso(handle.updatedAt),
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

export function volumeHandleData(handle: VolumeHandle): Record<string, unknown> {
  return {
    name: handle.name,
    kind: handle.kind,
    quotaMib: handle.quotaMib,
    usedBytes: handle.usedBytes,
    capacityBytes: handle.capacityBytes,
    diskFormat: handle.diskFormat,
    diskFstype: handle.diskFstype,
    labels: Object.fromEntries(handle.labels),
    createdAt: toIso(handle.createdAt),
  };
}

export function snapshotHandleData(handle: SnapshotHandle): Record<string, unknown> {
  return {
    digest: handle.digest,
    name: handle.name,
    parentDigest: handle.parentDigest,
    imageRef: handle.imageRef,
    format: handle.format,
    sizeBytes: bigintToString(handle.sizeBytes),
    createdAt: toIso(handle.createdAt),
    path: handle.path,
  };
}

export function snapshotData(snapshot: Snapshot): Record<string, unknown> {
  return {
    path: snapshot.path,
    digest: snapshot.digest,
    sizeBytes: snapshot.sizeBytes.toString(),
    imageRef: snapshot.imageRef,
    imageManifestDigest: snapshot.imageManifestDigest,
    format: snapshot.format,
    fstype: snapshot.fstype,
    parent: snapshot.parent,
    createdAt: snapshot.createdAt,
    labels: Object.fromEntries(snapshot.labels),
    sourceSandbox: snapshot.sourceSandbox,
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
