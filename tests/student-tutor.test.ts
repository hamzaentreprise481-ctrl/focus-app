import assert from "node:assert/strict";
import test from "node:test";
import {
  STUDENT_TUTOR_SYSTEM_PROMPT,
  studentTutorModel,
} from "../lib/student-tutor";

test("student tutor uses the low-cost dedicated model by default", () => {
  assert.equal(studentTutorModel(undefined), "gpt-6-luna");
  assert.equal(studentTutorModel("gpt-6.1-sol"), "gpt-6.1-sol");
});

test("student tutor prompt forbids grading and school-data writes", () => {
  assert.match(STUDENT_TUTOR_SYSTEM_PROMPT, /n’attribues jamais de note/i);
  assert.match(STUDENT_TUTOR_SYSTEM_PROMPT, /ne modifies aucune donnée scolaire/i);
});
