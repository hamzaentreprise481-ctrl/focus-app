import assert from "node:assert/strict";
import test from "node:test";
import { daysBetween, MIN_ELAPSED_WEEKS, percent, programmePace } from "../lib/director/metrics";

const YEAR = { yearStart: "2026-09-01", yearEnd: "2027-07-05" };

test("percent is null when there is nothing to measure and never exceeds 100", () => {
  assert.equal(percent(0, 0), null);
  assert.equal(percent(3, 0), null);
  assert.equal(percent(0, 8), 0);
  assert.equal(percent(5, 8), 63);
  assert.equal(percent(12, 8), 100);
});

test("no declaration is missing data, never a delay", () => {
  const pace = programmePace({ ...YEAR, covered: 0, total: 8, today: "2027-03-01" });
  assert.equal(pace.status, "no_data");
  assert.equal(pace.observedPerWeek, null);
});

test("an empty référentiel has no programme to measure", () => {
  assert.equal(programmePace({ ...YEAR, covered: 0, total: 0, today: "2027-03-01" }).status, "no_programme");
});

test("no pace is interpreted during the first weeks", () => {
  const pace = programmePace({ ...YEAR, covered: 1, total: 20, today: "2026-09-10" });
  assert.equal(pace.status, "too_early");
  assert.ok(pace.elapsedWeeks < MIN_ELAPSED_WEEKS);
});

test("on track, vigilance and risk follow the observed / needed pace ratio", () => {
  // 2027-01-05: 18 weeks elapsed, 26 weeks left.
  const today = "2027-01-05";
  const onTrack = programmePace({ ...YEAR, covered: 10, total: 20, today });
  assert.equal(onTrack.status, "on_track");
  assert.ok(onTrack.observedPerWeek! >= onTrack.neededPerWeek!);
  // Needed for 20 left in 26 weeks ≈ 0.77/week; 8 in 18 weeks ≈ 0.44/week… risk.
  const risk = programmePace({ ...YEAR, covered: 8, total: 28, today });
  assert.equal(risk.status, "at_risk");
  // 0.8 × needed ≤ observed < needed → vigilance.
  const watch = programmePace({ ...YEAR, covered: 9, total: 22, today });
  assert.equal(watch.status, "watch", JSON.stringify(watch));
  assert.ok(watch.ratioPercent! >= 80 && watch.ratioPercent! < 100, JSON.stringify(watch));
  assert.ok(onTrack.ratioPercent! >= 100);
  assert.ok(risk.ratioPercent! < 80);
});

test("a fully declared programme is done; remaining work after the year is at risk", () => {
  assert.equal(programmePace({ ...YEAR, covered: 8, total: 8, today: "2027-02-01" }).status, "done");
  const late = programmePace({ ...YEAR, covered: 5, total: 8, today: "2027-08-01" });
  assert.equal(late.status, "at_risk");
  assert.equal(late.remainingWeeks, 0);
});

test("covered never exceeds the programme and dates outside the year are clamped", () => {
  const pace = programmePace({ ...YEAR, covered: 50, total: 8, today: "2026-01-01" });
  assert.equal(pace.covered, 8);
  assert.equal(pace.elapsedWeeks, 0);
  assert.equal(daysBetween("2026-09-01", "2026-09-08"), 7);
});

test("the same inputs always give the same result", () => {
  const input = { ...YEAR, covered: 7, total: 19, today: "2027-02-10" };
  assert.deepEqual(programmePace(input), programmePace({ ...input }));
});
