import assert from "node:assert/strict";
import test from "node:test";
import {
  safeDirectorNext,
  safeNext,
  safeStudentNext,
} from "../lib/auth/policy";

test("each portal keeps redirects inside its own route", () => {
  assert.equal(safeNext("/app/classes"), "/app/classes");
  assert.equal(safeStudentNext("/student/progression"), "/student/progression");
  assert.equal(safeDirectorNext("/director/classes"), "/director/classes");

  assert.equal(safeNext("/student"), "/app");
  assert.equal(safeStudentNext("/director"), "/student");
  assert.equal(safeDirectorNext("/app"), "/director");
  assert.equal(safeDirectorNext("https://example.com/director"), "/director");
});
