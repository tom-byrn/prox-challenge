import assert from "node:assert/strict";
import test from "node:test";
import {
  createAccessSessionToken,
  isValidAccessPassword,
  isValidAccessSession,
  readAccessControlConfig
} from "./access-control.js";

test("local development is open when access control is not configured", () => {
  assert.deepEqual(readAccessControlConfig({}), {
    required: false,
    configured: false,
    password: "",
    sessionSecret: ""
  });
});

test("Vercel fails closed when either access secret is missing", () => {
  assert.deepEqual(readAccessControlConfig({ VERCEL: "1", ARCWELL_ACCESS_PASSWORD: "secret" }), {
    required: true,
    configured: false,
    password: "secret",
    sessionSecret: ""
  });
});

test("password and signed session token are validated", () => {
  const config = readAccessControlConfig({
    VERCEL: "1",
    ARCWELL_ACCESS_PASSWORD: "correct horse battery staple",
    ARCWELL_SESSION_SECRET: "a-different-server-only-secret"
  });
  const token = createAccessSessionToken(config);

  assert.equal(config.configured, true);
  assert.equal(isValidAccessPassword("correct horse battery staple", config), true);
  assert.equal(isValidAccessPassword("wrong password", config), false);
  assert.equal(isValidAccessSession(token, config), true);
  assert.equal(isValidAccessSession(`${token}x`, config), false);
  assert.equal(isValidAccessSession(undefined, config), false);
});
