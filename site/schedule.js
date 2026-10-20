// Pure schedule logic: data check, time windows, the bauch rule and the day list.
// No DOM access here, so it can be checked on its own (tests/schedule.test.js).
const Schedule = (() => {
  // Names as the scraper writes them (scraper/known_courses.json). "Bauch Beine Po"
  // is a full-body class and deliberately not counted as a bauch training.
  const BAUCH_NAMES = new Set(["Bauch Express", "Teamtraining Bauch"]);
  const BAUCH_GAP = 15; // minutes, see plan detail "bauch-rule"
  const TT_PREFIX = "Teamtraining ";
  const PLANS = new Set(["KP", "TT"]);
  const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
  const DAY_NAMES = ["", "Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag", "Sonntag"];
  const collator = new Intl.Collator("de");

  function toMin(hhmm) {
    const [h, m] = hhmm.split(":").map(Number);
    return h * 60 + m;
  }

  function isValidClass(cls) {
    return cls && Number.isInteger(cls.day) && cls.day >= 1 && cls.day <= 7
      && TIME.test(cls.start) && TIME.test(cls.end)
      && typeof cls.name === "string" && cls.name !== "" && PLANS.has(cls.plan);
  }

  // The file comes from OCR, so every row is checked once after loading. Bad rows
  // are dropped and counted; minutes are worked out here once for all later use.
  function clean(raw) {
    let dropped = 0;
    const studios = (Array.isArray(raw && raw.studios) ? raw.studios : [])
      .filter((s) => s && typeof s.slug === "string" && typeof s.name === "string" && Array.isArray(s.classes))
      .map((s) => {
        const classes = s.classes.filter(isValidClass)
          .map((c) => ({ ...c, from: toMin(c.start), to: toMin(c.end) }));
        dropped += s.classes.length - classes.length;
        const validFrom = /^\d{4}-\d{2}-\d{2}/.test(s.validFrom || "") ? s.validFrom : null;
        return { ...s, validFrom, classes };
      });
    return { updated: raw && raw.updated, studios, dropped };
  }

  // JavaScript counts Sunday as 0; the schedule counts Monday as 1 … Sunday as 7.
  function isoDay(date) {
    return date.getDay() === 0 ? 7 : date.getDay();
  }

  // "bis 00:00" means until the end of the day.
  function windowMinutes(w) {
    const to = toMin(w.to);
    return { from: toMin(w.from), to: to === 0 ? 24 * 60 : to };
  }

  function isWindowValid(w) {
    const m = windowMinutes(w);
    return m.from < m.to;
  }

  // settings.days[day]: true = the shared time, false = not a training day,
  // { from, to } = this day's own time. Returns null for a day that is off.
  function dayWindow(settings, day) {
    const d = settings.days[day];
    if (d === false) return null;
    return d && typeof d === "object" ? d : settings.time;
  }

  function activeDays(settings) {
    return [1, 2, 3, 4, 5, 6, 7].filter((day) => dayWindow(settings, day));
  }

  // A class fits when its day is on, it starts at or after "von" and is over by "bis".
  function fitsWindow(cls, settings) {
    const own = dayWindow(settings, cls.day);
    if (!own) return false;
    const w = windowMinutes(own);
    return cls.from >= w.from && cls.to <= w.to;
  }

  // Closest bauch class that ends within BAUCH_GAP minutes of the start (before it
  // or overlapping it), and closest that starts within BAUCH_GAP of the end.
  function bauchAround(cls, studioClasses) {
    let before = null;
    let after = null;
    for (const b of studioClasses) {
      if (b === cls || b.day !== cls.day || !BAUCH_NAMES.has(b.name)) continue;
      const gapBefore = Math.abs(b.to - cls.from);
      const gapAfter = Math.abs(b.from - cls.to);
      if (b.from < cls.from && gapBefore <= BAUCH_GAP && (!before || gapBefore < Math.abs(before.to - cls.from))) before = b;
      if (b.from > cls.from && gapAfter <= BAUCH_GAP && (!after || gapAfter < Math.abs(after.from - cls.to))) after = b;
    }
    return { before, after };
  }

  function entriesFor(schedule, settings) {
    const studios = new Set(settings.studios);
    const courses = new Set(settings.courses);
    const entries = [];
    for (const studio of schedule.studios) {
      if (!studios.has(studio.slug)) continue;
      for (const cls of studio.classes) {
        if (!courses.has(cls.name) || !fitsWindow(cls, settings)) continue;
        entries.push({ cls, studio, bauch: bauchAround(cls, studio.classes) });
      }
    }
    return entries;
  }

  // The training days Monday to Sunday, each with its matching classes sorted by
  // time. Days that are switched off are left out entirely.
  function buildDays(schedule, settings, today) {
    const byDay = new Map();
    for (const e of entriesFor(schedule, settings)) {
      if (!byDay.has(e.cls.day)) byDay.set(e.cls.day, []);
      byDay.get(e.cls.day).push(e);
    }
    const todayDay = isoDay(today);
    return activeDays(settings).map((day) => ({
      day,
      name: DAY_NAMES[day],
      isToday: day === todayDay,
      entries: (byDay.get(day) || [])
        .sort((a, b) => a.cls.from - b.cls.from || collator.compare(a.studio.name, b.studio.name)),
    }));
  }

  // All course names, split into course plan (KP) and team training (TT).
  function courseGroups(schedule) {
    const groups = { KP: new Set(), TT: new Set() };
    for (const studio of schedule.studios) {
      for (const cls of studio.classes) groups[cls.plan].add(cls.name);
    }
    const sorted = (set) => [...set].sort(collator.compare);
    return { KP: sorted(groups.KP), TT: sorted(groups.TT) };
  }

  function shortName(name) {
    return name.startsWith(TT_PREFIX) ? name.slice(TT_PREFIX.length) : name;
  }

  return {
    clean, buildDays, bauchAround, courseGroups, fitsWindow, dayWindow, activeDays, isWindowValid,
    shortName, collator, DAY_NAMES,
  };
})();

if (typeof module !== "undefined") module.exports = Schedule;
