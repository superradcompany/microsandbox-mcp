import assert from "node:assert/strict";
import test from "node:test";

import { selectSnapshotApi, Snapshot } from "../dist/utils/snapshot-api.js";
import { registerSnapshotTools } from "../dist/tools/snapshot.js";
import { registerResources } from "../dist/resources.js";

function artifactApi() {
  return Object.fromEntries(
    ["builder", "open", "get", "list", "remove", "reindex", "save", "load"].map((name) => [
      name,
      () => { throw new Error(`unexpected dispatch: ${name}`); },
    ]),
  );
}

test("legacy SDK selection is read-only and retains the original receiver", () => {
  const legacy = artifactApi();
  assert.equal(selectSnapshotApi({ Snapshot: legacy }), legacy);
});

test("group SDK selection uses Checkpoint without invoking a group operation", () => {
  const artifact = artifactApi();
  const group = new Proxy({}, { get() { throw new Error("must not inspect group methods"); } });
  assert.equal(selectSnapshotApi({ Snapshot: group, Checkpoint: artifact }), artifact);
});

test("incomplete artifact API is refused before dispatch instead of falling back", () => {
  const legacy = artifactApi();
  for (const method of Object.keys(legacy)) {
    const incomplete = artifactApi();
    delete incomplete[method];
    assert.throws(() => selectSnapshotApi({ Snapshot: legacy, Checkpoint: incomplete }), new RegExp(method));
  }
  for (const exports of [{}, { Snapshot: null }, { Snapshot: 1 }]) {
    assert.throws(() => selectSnapshotApi(exports), /does not expose/);
  }
});

test("a possibly applied mutation is never retried on the legacy API", async () => {
  let applied = 0;
  let legacyCalls = 0;
  const artifact = artifactApi();
  artifact.remove = async () => { applied++; throw new Error("confirmation lost after removal"); };
  const legacy = artifactApi();
  legacy.remove = async () => { legacyCalls++; };
  const selected = selectSnapshotApi({ Snapshot: legacy, Checkpoint: artifact });
  await assert.rejects(selected.remove("history:checkpoint"), /confirmation lost/);
  assert.equal(applied, 1);
  assert.equal(legacyCalls, 0);
});

test("snapshot tools and resource retain artifact-shaped results", async (t) => {
  const handle = {
    reference: "remote-id", referenceKind: "id", digest: "digest", name: "ready",
    parentDigest: null, scope: "disk", imageRef: "alpine", format: "raw",
    sizeBytes: 123n, createdAt: new Date("2026-10-20T00:00:00Z"),
  };
  t.mock.method(Snapshot, "list", async () => [handle]);
  const tools = new Map();
  registerSnapshotTools({ registerTool(name, config, handler) { tools.set(name, handler); } });
  const response = await tools.get("snapshot_list")({});
  const envelope = JSON.parse(response.content[0].text);
  assert.equal(envelope.ok, true);
  const expected = {
    reference: "remote-id", referenceKind: "id", path: null, digest: "digest", name: "ready",
    parentDigest: null, scope: "disk", imageRef: "alpine", format: "raw",
    sizeBytes: "123", createdAt: "2026-10-20T00:00:00.000Z",
  };
  assert.deepEqual(envelope.data, [expected]);
  const resources = new Map();
  registerResources({ registerResource(name, uri, config, handler) { resources.set(name, { uri, handler }); } });
  const resource = resources.get("snapshots");
  assert.ok(resource);
  const result = await resource.handler(new URL(resource.uri));
  assert.deepEqual(JSON.parse(result.contents[0].text), [expected]);
});

test("tool reports a mutation error without redispatch", async (t) => {
  let calls = 0;
  t.mock.method(Snapshot, "remove", async () => { calls++; throw new Error("result uncertain"); });
  const tools = new Map();
  registerSnapshotTools({ registerTool(name, config, handler) { tools.set(name, handler); } });
  const response = await tools.get("snapshot_remove")({ pathOrName: "history:ready" });
  assert.equal(response.isError, true);
  assert.match(response.content[0].text, /result uncertain/);
  assert.equal(calls, 1);
});
