import assert from "node:assert/strict";
import test from "node:test";
import { safeNext, safeStudentNext } from "../lib/auth/policy";

test("student redirects stay inside the student portal", () => {
  assert.equal(
    safeStudentNext("/student/evaluations?filtre=recent"),
    "/student/evaluations?filtre=recent",
  );
  assert.equal(safeStudentNext("/student/progression"), "/student/progression");
  assert.equal(safeStudentNext("/app"), "/student");
  assert.equal(safeStudentNext("https://example.com/student"), "/student");
});

test("teacher and student redirect allowlists remain isolated", () => {
  assert.equal(safeNext("/student"), "/app");
  assert.equal(safeStudentNext("/app/evaluations"), "/student");
  assert.equal(safeNext("/app/evaluations"), "/app/evaluations");
});
