import assert from "node:assert/strict";
import test from "node:test";
import { normalizeRelativePath } from "../src/utils.ts";

test("normalizeRelativePath normalizes safe relative paths", () => {
  assert.equal(normalizeRelativePath("./foo/bar"), "foo/bar");
  assert.equal(normalizeRelativePath("foo\\bar"), "foo/bar");
  assert.equal(normalizeRelativePath("foo//bar"), "foo/bar");
});

test("normalizeRelativePath rejects traversal and repo-root aliases", () => {
  for (const candidate of [".", "./", ".//", "", "..", "a/..", "a/../b"]) {
    assert.throws(() => normalizeRelativePath(candidate), /invalid relative path/u);
  }
});

test("normalizeRelativePath rejects Windows drive-prefixed paths", () => {
  for (const candidate of ["C:/repo/file.md", "C:\\repo\\file.md", "C:repo/file.md"]) {
    assert.throws(() => normalizeRelativePath(candidate), /invalid relative path/u);
  }
});
