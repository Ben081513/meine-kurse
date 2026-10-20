// Checks the app's schedule logic. Run with: node --test tests/
const test = require("node:test");
const assert = require("node:assert");

global.Schedule = require("../site/schedule.js");
const Settings = require("../site/settings.js");
const realData = require("../site/data/schedule.json");

const ALL_DAY = { from: "00:00", to: "23:59" };
const EVERY_DAY = { 1: true, 2: true, 3: true, 4: true, 5: true, 6: true, 7: true };

function studio(classes) {
  return Schedule.clean({ updated: "2026-10-20T11:00:00Z", studios: [{ slug: "x", name: "X", validFrom: "2026-10-01", classes }] });
}

function cls(day, start, end, name) {
  return { day, start, end, name, plan: name.startsWith("Teamtraining") ? "TT" : "KP", raw: name, sure: true };
}

function bauchFor(bauchStart, bauchEnd) {
  const data = studio([cls(1, "10:00", "10:50", "BodyPump"), cls(1, bauchStart, bauchEnd, "Teamtraining Bauch")]);
  const [course, ...rest] = data.studios[0].classes;
  return Schedule.bauchAround(course, [course, ...rest]);
}

test("bauch before: ends at most 15 min before start, or overlaps by up to 15", () => {
  assert.ok(bauchFor("09:25", "09:45").before);
  assert.equal(bauchFor("09:24", "09:44").before, null);
  assert.ok(bauchFor("09:55", "10:15").before);
  assert.equal(bauchFor("09:56", "10:16").before, null);
});

test("bauch after: starts at most 15 min after end, or up to 15 before it", () => {
  assert.ok(bauchFor("11:05", "11:25").after);
  assert.equal(bauchFor("11:06", "11:26").after, null);
  assert.ok(bauchFor("10:35", "10:55").after);
});

test("Bauch Beine Po is not a bauch training", () => {
  const data = studio([cls(1, "10:00", "10:50", "BodyPump"), cls(1, "11:00", "11:50", "Bauch Beine Po")]);
  const [course] = data.studios[0].classes;
  assert.equal(Schedule.bauchAround(course, data.studios[0].classes).after, null);
});

test("windows: start at or after von, end by bis; bis 00:00 means end of day", () => {
  const [c] = studio([cls(2, "16:00", "16:50", "BodyPump")]).studios[0].classes;
  const at = (from, to) => ({ time: { from, to }, days: EVERY_DAY });
  assert.ok(Schedule.fitsWindow(c, at("16:00", "23:59")));
  assert.ok(!Schedule.fitsWindow(c, at("16:01", "23:59")));
  assert.ok(!Schedule.fitsWindow(c, at("00:00", "16:49")));
  assert.ok(Schedule.isWindowValid({ from: "18:00", to: "00:00" }));
  assert.ok(!Schedule.isWindowValid({ from: "18:00", to: "08:00" }));
});

test("clean drops malformed rows instead of failing", () => {
  const data = studio([cls(1, "10:00", "10:50", "BodyPump"), { day: 1, start: "10.00", end: null, name: "X", plan: "KP" }, cls(8, "10:00", "10:50", "Yoga")]);
  assert.equal(data.studios[0].classes.length, 1);
  assert.equal(data.dropped, 2);
});

test("prune forgets studios and courses the plan no longer has", () => {
  const data = studio([cls(1, "10:00", "10:50", "BodyPump")]);
  const pruned = Settings.prune(Settings.normalize({ studios: ["x", "gone"], courses: ["BodyPump", "Old"] }), data);
  assert.deepStrictEqual([pruned.studios, pruned.courses], [["x"], ["BodyPump"]]);
});

test("acceptance: Mitte + Friedrichshain, BodyPump + Heavy, Mo–Fr ab 16:00", () => {
  const data = Schedule.clean(realData);
  assert.equal(data.dropped, 0);
  const settings = {
    studios: ["mitte", "friedrichshain"],
    courses: ["BodyPump", "BodyPump Heavy"],
    time: { from: "16:00", to: "23:59" },
    days: { ...EVERY_DAY, 6: ALL_DAY, 7: ALL_DAY },
  };
  const days = Schedule.buildDays(data, settings, new Date(2026, 9, 20)); // Tuesday
  assert.deepStrictEqual(days.map((d) => d.day), [1, 2, 3, 4, 5, 6, 7]);
  assert.deepStrictEqual(days.filter((d) => d.isToday).map((d) => d.day), [2]);
  const all = days.flatMap((d) => d.entries);
  assert.ok(all.length > 0);
  assert.ok(all.every((e) => e.cls.day >= 6 || e.cls.from >= 16 * 60));
  const monHeavy = days[0].entries.find((e) => e.cls.name === "BodyPump Heavy" && e.studio.slug === "mitte");
  assert.equal(monHeavy.bauch.before.start, "19:30");
});

test("Sunday is the last day and still marked as today", () => {
  const days = Schedule.buildDays(studio([]), { studios: [], courses: [], time: ALL_DAY, days: EVERY_DAY }, new Date(2026, 9, 25));
  assert.deepStrictEqual(days.filter((d) => d.isToday).map((d) => d.day), [7]);
  assert.equal(days[6].name, "Sonntag");
});

test("acceptance: Di, Mi, Sa ab 16:00, Mi ab 18:00; global change keeps Mi", () => {
  const data = Schedule.clean(realData);
  const settings = Settings.normalize({
    studios: data.studios.map((s) => s.slug),
    courses: Schedule.courseGroups(data).KP,
    time: { from: "16:00", to: "23:59" },
    days: { 1: false, 2: true, 3: { from: "18:00", to: "23:59" }, 4: false, 5: false, 6: true, 7: false },
  });
  const days = Schedule.buildDays(data, settings, new Date(2026, 9, 20));
  assert.deepStrictEqual(days.map((d) => d.day), [2, 3, 6]);
  const starts = (list, day) => list.find((d) => d.day === day).entries.map((e) => e.cls.from);
  assert.ok(starts(days, 2).length > 0 && starts(days, 2).every((m) => m >= 16 * 60));
  assert.ok(starts(days, 3).length > 0 && starts(days, 3).every((m) => m >= 18 * 60));
  const later = Schedule.buildDays(data, { ...settings, time: { from: "17:00", to: "23:59" } }, new Date(2026, 9, 20));
  assert.ok(starts(later, 2).every((m) => m >= 17 * 60));
  assert.ok(starts(later, 6).every((m) => m >= 17 * 60));
  assert.deepStrictEqual(starts(later, 3), starts(days, 3));
});

test("no training day means no days in the list", () => {
  const off = { 1: false, 2: false, 3: false, 4: false, 5: false, 6: false, 7: false };
  assert.deepStrictEqual(Schedule.buildDays(studio([]), { studios: [], courses: [], time: ALL_DAY, days: off }, new Date()), []);
});

test("normalize keeps day choices and repairs broken times", () => {
  const s = Settings.normalize({ time: { from: "17:00", to: "kaputt" }, days: { 2: false, 3: { from: "18:00" }, 6: "ja" } });
  assert.deepStrictEqual(s.time, { from: "17:00", to: "23:59" });
  assert.deepStrictEqual([s.days[1], s.days[2], s.days[3], s.days[6]], [true, false, { from: "18:00", to: "23:59" }, true]);
});

test("old saved choice (Mo–Fr / Sa–So) is taken over", () => {
  const same = Settings.fromV1({ studios: ["x"], courses: ["BodyPump"], windows: { weekday: { from: "16:00", to: "23:59" }, weekend: { from: "16:00", to: "23:59" } }, showBauch: false });
  assert.deepStrictEqual(same.time, { from: "16:00", to: "23:59" });
  assert.deepStrictEqual(same.days, EVERY_DAY);
  assert.deepStrictEqual([same.studios, same.courses, same.showBauch], [["x"], ["BodyPump"], false]);
  const differs = Settings.fromV1({ windows: { weekday: { from: "16:00", to: "23:59" }, weekend: { from: "09:00", to: "14:00" } } });
  assert.deepStrictEqual(differs.days[5], true);
  assert.deepStrictEqual([differs.days[6], differs.days[7]], [{ from: "09:00", to: "14:00" }, { from: "09:00", to: "14:00" }]);
});

test("bauch display is on by default and can be switched off", () => {
  assert.equal(Settings.normalize({}).showBauch, true);
  assert.equal(Settings.normalize({ showBauch: false }).showBauch, false);
  assert.equal(Settings.normalize({ showBauch: "nein" }).showBauch, true);
});

test("studio colors follow the alphabetical order of the chosen studios", () => {
  global.StudioColors = require("../site/colors.js");
  const data = Schedule.clean(realData);
  const picked = StudioColors.forSelection(data, { studios: ["mitte", "friedrichshain"] });
  assert.deepStrictEqual(picked.map((x) => x.studio.name), ["Friedrichshain", "Mitte"]);
  assert.notEqual(picked[0].color.border, picked[1].color.border);
});

test("PDF header names the chosen days and the days with their own time", () => {
  const DayTimes = require("../site/days.js");
  const s = Settings.normalize({ time: { from: "16:00", to: "23:59" }, days: { 1: false, 3: { from: "18:00", to: "23:59" }, 4: false, 5: false, 6: { from: "10:00", to: "14:00" }, 7: false } });
  assert.equal(DayTimes.summary(s), "Di, Mi, Sa · 16:00–23:59 · Mi ab 18:00 · Sa 10:00–14:00");
  assert.equal(DayTimes.summary(Settings.normalize({})), "Mo–So · 00:00–23:59");
});
