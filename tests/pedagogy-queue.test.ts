import test from "node:test";
import assert from "node:assert/strict";
import { pickNextEvidenceSet } from "../lib/pedagogy/queue";

test("selects the newest unanalyzed evidence set before reusing a completed run", () => {
  const items = [
    { id: "latest", existing: { id: "run-latest" } },
    { id: "middle", existing: null },
    { id: "oldest", existing: null },
  ];
  assert.equal(pickNextEvidenceSet(items)?.id, "middle");
});

test("reuses the newest evidence set only after every current evidence hash has a run", () => {
  const items = [
    { id: "latest", existing: { id: "run-latest" } },
    { id: "older", existing: { id: "run-older" } },
  ];
  assert.equal(pickNextEvidenceSet(items)?.id, "latest");
});

test("returns null when no assessment is reviewable", () => {
  assert.equal(pickNextEvidenceSet([]), null);
});
