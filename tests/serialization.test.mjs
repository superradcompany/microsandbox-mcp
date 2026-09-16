import assert from "node:assert/strict";
import test from "node:test";

import { snapshotData, snapshotHandleData } from "../dist/utils/serialization.js";

function snapshotFixture(referenceKind) {
  return {
    reference: referenceKind === "path" ? "/snapshots/app/ready" : "snapshot-cloud-id",
    referenceKind,
    // Cloud snapshots do not have a host path; neither serializer should call this getter.
    get path() { throw new Error("deprecated path getter must not be read"); },
    digest: "sha256:descriptor",
    name: "ready",
    parentDigest: "sha256:parent",
    sizeBytes: 4096n,
    imageRef: "alpine:3.20",
    imageManifestDigest: "sha256:image",
    scope: "disk",
    format: "raw",
    fstype: "ext4",
    parent: "sha256:parent",
    createdAt: "2026-09-15T00:00:00Z",
    labels: new Map([["app", "example"]]),
    sourceSandbox: "app/source",
  };
}

for (const [kind, serialize] of [["snapshot", snapshotData], ["handle", snapshotHandleData]]) {
  for (const referenceKind of ["path", "id"]) {
    test(`${kind} preserves ${referenceKind} references without reading the path getter`, () => {
      const fixture = snapshotFixture(referenceKind);
      const serialized = serialize(fixture);

      assert.equal(serialized.reference, fixture.reference);
      assert.equal(serialized.referenceKind, referenceKind);
      assert.equal(serialized.path, referenceKind === "path" ? fixture.reference : null);
      assert.equal(serialized.digest, fixture.digest);
      assert.equal(serialized.sizeBytes, "4096");
      assert.equal(serialized.scope, "disk");
      assert.equal(serialized.createdAt, fixture.createdAt);
      assert.doesNotThrow(() => JSON.stringify(serialized));
    });
  }

  test(`${kind} preserves an unknown cloud snapshot size`, () => {
    const fixture = snapshotFixture("id");
    fixture.sizeBytes = null;
    assert.equal(serialize(fixture).sizeBytes, null);
  });
}

test("snapshot serialization preserves labels and capture metadata", () => {
  const serialized = snapshotData(snapshotFixture("id"));
  assert.deepEqual(serialized.labels, { app: "example" });
  assert.equal(serialized.parent, "sha256:parent");
  assert.equal(serialized.sourceSandbox, "app/source");
  assert.equal(serialized.imageManifestDigest, "sha256:image");
});

test("snapshot handle serialization preserves summary metadata", () => {
  const fixture = snapshotFixture("id");
  fixture.createdAt = new Date("2026-09-15T00:00:00Z");
  const serialized = snapshotHandleData(fixture);
  assert.equal(serialized.name, "ready");
  assert.equal(serialized.parentDigest, "sha256:parent");
  assert.equal(serialized.createdAt, "2026-09-15T00:00:00.000Z");
});
