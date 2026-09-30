// Runs without AWS: checks the calendar rules the tools rely on.
import { test } from "node:test";
import assert from "node:assert/strict";
import { AppointmentDatabase } from "../src/database/AppointmentDatabase.ts";
import { AppointmentTools, DEFAULT_SCHEDULING } from "../src/tools/AppointmentTools.ts";
import { resolveSettings, validateSettings, DEFAULTS } from "../src/config.ts";

function calendarWith3pmMeeting() {
  const db = new AppointmentDatabase(":memory:");
  const id = db.createAppointment("2026-10-07 15:00", "DC", "Agent fun", "");
  return { db, id };
}

test("a meeting at the same time clashes", () => {
  const { db } = calendarWith3pmMeeting();
  assert.equal(db.findConflicts("2026-10-07 15:00", 60).length, 1);
});

test("overlapping on either side clashes", () => {
  const { db } = calendarWith3pmMeeting();
  assert.equal(db.findConflicts("2026-10-07 14:30", 60).length, 1);
  assert.equal(db.findConflicts("2026-10-07 15:30", 60).length, 1);
});

test("back-to-back meetings do not clash", () => {
  const { db } = calendarWith3pmMeeting();
  assert.equal(db.findConflicts("2026-10-07 14:00", 60).length, 0);
  assert.equal(db.findConflicts("2026-10-07 16:00", 60).length, 0);
});

test("moving a meeting ignores its own slot", () => {
  const { db, id } = calendarWith3pmMeeting();
  assert.equal(db.findConflicts("2026-10-07 15:00", 60, id).length, 0);
});

test("free slots skip the busy hour and stay within working hours", () => {
  const { db } = calendarWith3pmMeeting();
  const slots = db.freeSlots("2026-10-07", 60, 9, 18);
  assert.equal(slots[0], "09:00");
  assert.equal(slots.at(-1), "17:00");
  for (const busy of ["14:30", "15:00", "15:30"]) assert.ok(!slots.includes(busy), busy);
});

test("a clash returns a conflict report with the three nearest free times", () => {
  const { db } = calendarWith3pmMeeting();
  const tools = new AppointmentTools(db, DEFAULT_SCHEDULING) as any;
  const report = JSON.parse(tools.conflictResult("2026-10-07 15:00", 60));
  assert.equal(report.status, "conflict");
  assert.equal(report.conflicts[0].title, "Agent fun");
  assert.deepEqual(report.suggested_start_times, ["13:30", "14:00", "16:00"]);
});

test("no clash means no report", () => {
  const { db } = calendarWith3pmMeeting();
  const tools = new AppointmentTools(db, DEFAULT_SCHEDULING) as any;
  assert.equal(tools.conflictResult("2026-10-07 11:00", 60), undefined);
});

test("settings: flag beats environment variable beats default", () => {
  process.env.AWS_REGION = "eu-west-1";
  const fromEnv = resolveSettings({}, "/nonexistent/config.json");
  assert.equal(fromEnv.values.region, "eu-west-1");
  assert.equal(fromEnv.sources.region, "env");
  const fromFlag = resolveSettings({ region: "us-west-2" }, "/nonexistent/config.json");
  assert.equal(fromFlag.values.region, "us-west-2");
  assert.equal(fromFlag.sources.region, "flag");
  delete process.env.AWS_REGION;
  assert.equal(resolveSettings({}, "/nonexistent/config.json").sources.region, "default");
});

test("invalid settings are rejected with a reason", () => {
  const problems = validateSettings({ ...DEFAULTS, region: "mars", timezone: "Moon/Base", duration: 0, workday: "9to5" });
  assert.equal(problems.length, 4);
  assert.deepEqual(validateSettings(DEFAULTS), []);
});
