import assert from "node:assert/strict";
import test from "node:test";

import { fail, ok } from "../dist/utils/response.js";

test("ok returns a parseable JSON success envelope", () => {
  const result = ok({ value: 42 });
  const body = JSON.parse(result.content[0].text);

  assert.equal(result.isError, undefined);
  assert.deepEqual(body, {
    ok: true,
    data: { value: 42 },
  });
});

test("fail returns a parseable JSON error envelope and redacts secrets", () => {
  const result = fail("invalid_input", "bad input", {
    details: {
      username: "user",
      password: "super-secret",
      nested: { token: "abc" },
    },
  });
  const body = JSON.parse(result.content[0].text);

  assert.equal(result.isError, true);
  assert.equal(body.ok, false);
  assert.equal(body.error.code, "invalid_input");
  assert.equal(body.error.details.password, "[redacted]");
  assert.equal(body.error.details.nested.token, "[redacted]");
});
