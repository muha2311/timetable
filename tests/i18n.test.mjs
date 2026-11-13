import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { courses } from "../scripts/seed/academic.mjs";
import { slug } from "../scripts/seed/ids.mjs";
import { DAYS, ROLES, SEMESTERS, SESSION_TYPES, DEFAULT_TIME_SLOTS } from "../src/domain/constants.ts";

const load = (l) => {
  const file = `src/locales/${l}/translation.json`;
  try { return JSON.parse(readFileSync(file, "utf8")); }
  catch (e) { throw new Error(`Cannot read ${file} (run npm test from the project root; the file must be at exactly this path): ${e.message}`); }
};
const en = load("en"), ar = load("ar");
const vars = (s) => [...s.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]).sort().join();

test("English and Arabic have exactly the same keys and no empty values", () => {
  assert.deepEqual(Object.keys(ar).sort(), Object.keys(en).sort());
  for (const [k, v] of [...Object.entries(en), ...Object.entries(ar)]) assert.ok(v.length > 0 || k === "list.sep", k);
});
test("placeholders match between languages", () => { for (const k of Object.keys(en)) assert.equal(vars(ar[k]), vars(en[k]), k); });
test("every dynamic key family is fully translated", () => {
  const need = [...DAYS.map((d) => `day.${d}`), ...ROLES.map((r) => `role.${r}`), ...SEMESTERS.map((s) => `semester.${s}`),
    ...SESSION_TYPES.flatMap((s) => [`session.${s}`, `badge.${s}`]), ...DEFAULT_TIME_SLOTS.map((s) => `slot.${s.id}`),
    "conflict.instructor", "conflict.classroom", "conflict.section"];
  for (const k of need) assert.ok(en[k] && ar[k], k);
});
test("every literal translation key used in src exists", () => {
  const files = []; (function walk(d) { for (const f of readdirSync(d)) { const p = join(d, f); statSync(p).isDirectory() ? walk(p) : /\.tsx?$/.test(p) && files.push(p); } })("src");
  const ns = new Set(Object.keys(en).map((k) => k.split(".")[0]));
  const missing = [];
  for (const f of files.filter((x) => !/[\\/](domain|repositories|services)[\\/]/.test(x))) for (const m of readFileSync(f, "utf8").matchAll(/["`]([a-z]+\.[A-Za-z_]+)["`]/g)) if (ns.has(m[1].split(".")[0]) && !(m[1] in en)) missing.push(`${f}: ${m[1]}`);
  assert.deepEqual(missing, []);
});
test("Arabic strings contain Arabic text, and stored values are not translated keys", () => {
  assert.ok(/[\u0600-\u06FF]/.test(ar["nav.timetable"]));
  assert.equal(ROLES[3], "Teaching Assistant"); // stored value stays English; only role.* labels are translated
});

test("every seeded course has a translation key in both languages (English = canonical name)", () => {
  for (const c of courses()) { const k = `course.${slug(c.data.name)}`; assert.equal(en[k], c.data.name); assert.ok(/[\u0600-\u06FF]/.test(ar[k]), k); }
});

test("dynamic key families added for offline sync and invigilation are fully translated", () => {
  const need = [...["synced", "offline", "syncing", "pending", "failed", "conflict"].map((s) => `sync.state.${s}`), ...["pending", "syncing", "conflict", "failed"].map((s) => `sync.status.${s}`),
    ...["timetable.save", "timetable.delete", "exam.save", "exam.delete", "invigilation.save"].map((s) => `sync.op.${s}`),
    ...["network", "modified_elsewhere", "scheduling_conflict", "exam_validation", "invigilation_invalid", "exam_missing", "permission-denied", "error"].map((s) => `sync.err.${s}`),
    ...["unknown_person", "inactive", "category_mismatch", "duplicate", "busy_elsewhere", "room_not_occupied", "too_many", "admin_while_ta_available"].map((s) => `slotIssue.${s}`),
    ...["complete", "incomplete", "invalid"].map((s) => `inv.room.${s}`), ...["staffed", "incomplete", "invalid"].map((s) => `inv.status.${s}`), "invCat.TA", "invCat.ADMIN"];
  for (const k of need) assert.ok(en[k] && ar[k], k);
});
