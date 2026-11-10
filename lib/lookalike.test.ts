import assert from "node:assert/strict";
import test from "node:test";
import { findLookalike } from "./lookalike.ts";

const real = "0x4e8f1c2a9b7d6e5c3a18f0d4b27c91aa06e35d17";
const poison = "0x4e8fa91c0d4e77b2c61890ab44f13c8e06e35d17";

test("flags an address that copies the head and tail", () => {
  const hit = findLookalike("ethereum", poison, [real]);
  assert.ok(hit);
  assert.equal(hit.registered, real);
  assert.ok(hit.prefix >= 4);
  assert.ok(hit.suffix >= 4);
});

test("does not flag the real address against itself", () => {
  assert.equal(findLookalike("ethereum", real, [real]), null);
});

test("does not flag an unrelated address", () => {
  const other = "0x1111111111111111111111111111111111111111";
  assert.equal(findLookalike("ethereum", other, [real]), null);
});

test("requires both the head and the tail to match", () => {
  const headOnly = "0x4e8f111111111111111111111111111111111111";
  assert.equal(findLookalike("ethereum", headOnly, [real]), null);
});
