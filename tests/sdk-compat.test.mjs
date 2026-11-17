import assert from "node:assert/strict";
import test from "node:test";

import { connectSandbox, sandboxStatus, startSandbox } from "../dist/utils/sdk-compat.js";
import { sandboxHandleData, volumeHandleData, snapshotData } from "../dist/utils/serialization.js";

test("captured resource observations serialize resolved data", async () => {
  const sandbox = {
    name: "task",
    info: async () => ({ status: "stopped", createdAt: null, updatedAt: null }),
    config: async () => ({ image: "alpine", labels: { role: "test" } }),
  };
  assert.deepEqual(await sandboxHandleData(sandbox), {
    name: "task", status: "stopped", config: { image: "alpine", labels: { role: "test" } },
    createdAt: null, updatedAt: null,
  });
  const volume = { info: async () => ({
    name: "data", kind: "directory", quotaMib: 128, usedBytes: 7, capacityBytes: null,
    diskFormat: null, diskFstype: null, labels: [["role", "test"]], createdAt: null,
  }) };
  assert.deepEqual(await volumeHandleData(volume), {
    name: "data", kind: "directory", quotaMib: 128, usedBytes: 7, capacityBytes: null,
    diskFormat: null, diskFstype: null, labels: { role: "test" }, createdAt: null,
  });
  const snapshot = await snapshotData({
    reference: "snapshot-id", referenceKind: "id", sizeBytes: null,
    labels: async () => [["role", "test"]],
    imageManifestDigest: async () => "sha256:image", sourceSandbox: async () => "task",
  });
  assert.deepEqual(snapshot.labels, { role: "test" });
  assert.equal(snapshot.imageManifestDigest, "sha256:image");
  assert.equal(snapshot.sourceSandbox, "task");
});

test("resource selection does not start a stopped sandbox implicitly", async () => {
  let starts = 0;
  let detaches = 0;
  const resource = {
    name: "task", running: false,
    async status() { return this.running ? "running" : "stopped"; },
    async ensureRunning() { starts++; this.running = true; },
    async detach() { detaches++; },
  };
  assert.equal(await sandboxStatus(resource), "stopped");
  await assert.rejects(connectSandbox(resource), /not running/);
  assert.equal(starts, 0);
  assert.equal(await startSandbox(resource), resource);
  assert.equal(starts, 1);
  assert.equal(detaches, 1);
  assert.equal(await connectSandbox(resource), resource);
});

test("legacy lifecycle operations retain their receiver and never retry failures", async () => {
  const running = {};
  let starts = 0;
  const handle = {
    status: "running",
    async connect() { assert.equal(this, handle); return running; },
    async startDetached() { starts++; throw new Error("start confirmation lost"); },
  };
  assert.equal(await sandboxStatus(handle), "running");
  assert.equal(await connectSandbox(handle), running);
  await assert.rejects(startSandbox(handle), /confirmation lost/);
  assert.equal(starts, 1);
});
