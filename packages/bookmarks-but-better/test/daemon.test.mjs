// The one decision in daemon.mjs that needs no machine: where the daemon is.

import assert from "node:assert/strict";
import test from "node:test";

import { originOf } from "../lib/daemon.mjs";

test("the daemon's address comes from the registry, else the service, else the defaults", () => {
  assert.equal(originOf({ registry: null, service: null }), "http://127.0.0.1:52222");
  assert.equal(originOf({ registry: { bind: "127.0.0.1", port: 4000 }, service: { port: 5000 } }), "http://127.0.0.1:4000");
  assert.equal(originOf({ registry: null, service: { port: 5000 } }), "http://127.0.0.1:5000");
  // A registry that names no port (the daemon's default) still wins on bind.
  assert.equal(originOf({ registry: { bind: "::1", port: null }, service: { port: 5000 } }), "http://[::1]:5000");
});
