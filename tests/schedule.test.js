// Checks the app's schedule logic. Run with: node --test tests/
const test = require("node:test");
const assert = require("node:assert");

global.Schedule = require("../site/schedule.js");
const Settings = require("../site/settings.js");
const realData = require("../site/data/schedule.json");

const ALL_DAY = { from: "00:00", to: "23:59" };

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
  assert.ok(Schedule.fitsWindow(c, { weekday: { from: "16:00", to: "23:59" }, weekend: ALL_DAY }));
  assert.ok(!Schedule.fitsWindow(c, { weekday: { from: "16:01", to: "23:59" }, weekend: ALL_DAY }));
  assert.ok(!Schedule.fitsWindow(c, { weekday: { from: "00:00", to: "16:49" }, weekend: ALL_DAY }));
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
    windows: { weekday: { from: "16:00", to: "23:59" }, weekend: ALL_DAY },
  };
  const days = Schedule.buildDays(data, settings, new Date(2026, 9, 20)); // Tuesday
  assert.deepStrictEqual(days.map((d) => d.day), [2, 3, 4, 5, 6, 7, 1]);
  const all = days.flatMap((d) => d.entries);
  assert.ok(all.length > 0);
  assert.ok(all.every((e) => e.cls.day >= 6 || e.cls.from >= 16 * 60));
  const monHeavy = days[6].entries.find((e) => e.cls.name === "BodyPump Heavy" && e.studio.slug === "mitte");
  assert.equal(monHeavy.bauch.before.start, "19:30");
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
