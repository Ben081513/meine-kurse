// The user's choice of studios, courses, training days and times: kept in
// localStorage and edited on the settings screen.
const Settings = (() => {
  const KEY = "meine-kurse:settings:v2";
  const OLD_KEY = "meine-kurse:settings:v1";
  const DAYS = [1, 2, 3, 4, 5, 6, 7];
  const ALL_DAY = { from: "00:00", to: "23:59" };
  // days: true = the shared time, false = not a training day, { from, to } = own time.
  const DEFAULTS = {
    studios: [],
    courses: [],
    time: { ...ALL_DAY },
    days: { 1: true, 2: true, 3: true, 4: true, 5: true, 6: true, 7: true },
    showBauch: true,
  };

  function validTime(value, fallback) {
    return /^([01]\d|2[0-3]):[0-5]\d$/.test(value || "") ? value : fallback;
  }

  function strings(list) {
    return Array.isArray(list) ? list.filter((x) => typeof x === "string") : [];
  }

  function time(raw, fallback) {
    return { from: validTime(raw && raw.from, fallback.from), to: validTime(raw && raw.to, fallback.to) };
  }

  function normalize(raw) {
    const s = structuredClone(DEFAULTS);
    if (!raw || typeof raw !== "object") return s;
    s.studios = strings(raw.studios);
    s.courses = strings(raw.courses);
    if (typeof raw.showBauch === "boolean") s.showBauch = raw.showBauch;
    s.time = time(raw.time, ALL_DAY);
    for (const day of DAYS) {
      const d = raw.days && raw.days[day];
      if (d === false) s.days[day] = false;
      else if (d && typeof d === "object") s.days[day] = time(d, s.time);
    }
    return s;
  }

  // The old format had one window for Mo–Fr and one for Sa–So. The Mo–Fr time
  // becomes the shared time; Sa and So get their own only when it differed.
  function fromV1(raw) {
    const s = normalize(raw);
    const w = raw && raw.windows;
    if (!w) return s;
    s.time = time(w.weekday, ALL_DAY);
    const weekend = time(w.weekend, ALL_DAY);
    const same = weekend.from === s.time.from && weekend.to === s.time.to;
    s.days[6] = same ? true : { ...weekend };
    s.days[7] = same ? true : { ...weekend };
    return s;
  }

  function load() {
    try {
      const saved = localStorage.getItem(KEY);
      if (saved !== null) return normalize(JSON.parse(saved));
      const old = localStorage.getItem(OLD_KEY);
      return old === null ? structuredClone(DEFAULTS) : fromV1(JSON.parse(old));
    } catch (err) {
      console.warn("Gespeicherte Auswahl unlesbar, starte leer", err);
      return structuredClone(DEFAULTS);
    }
  }

  function save(settings) {
    try {
      localStorage.setItem(KEY, JSON.stringify(settings));
    } catch (err) {
      // Private mode or full storage: the choice still works until the app closes.
      console.warn("Auswahl konnte nicht gespeichert werden", err);
    }
  }

  // Drops saved studios and courses the current plan no longer has, so a
  // renamed course does not leave the list empty without a hint.
  function prune(settings, schedule) {
    const slugs = new Set(schedule.studios.map((s) => s.slug));
    const names = new Set(schedule.studios.flatMap((s) => s.classes.map((c) => c.name)));
    return {
      ...settings,
      studios: settings.studios.filter((x) => slugs.has(x)),
      courses: settings.courses.filter((x) => names.has(x)),
    };
  }

  function isEmpty(settings) {
    return settings.studios.length === 0 || settings.courses.length === 0;
  }

  function chip(value, label, isChecked) {
    const el = document.createElement("label");
    el.className = "chip";
    const input = document.createElement("input");
    input.type = "checkbox";
    input.value = value;
    input.checked = isChecked;
    const text = document.createElement("span");
    text.textContent = label;
    el.append(input, text);
    return el;
  }

  function groupTitle(text) {
    const el = document.createElement("p");
    el.className = "group-title";
    el.textContent = text;
    return el;
  }

  function renderStudios(container, schedule, settings) {
    const chosen = new Set(settings.studios);
    const studios = [...schedule.studios].sort((a, b) => Schedule.collator.compare(a.name, b.name));
    container.replaceChildren(...studios.map((s) => chip(s.slug, s.name, chosen.has(s.slug))));
  }

  function renderCourses(container, schedule, settings) {
    const chosen = new Set(settings.courses);
    const groups = Schedule.courseGroups(schedule);
    const toChip = (n) => chip(n, Schedule.shortName(n), chosen.has(n));
    container.replaceChildren(
      groupTitle("Kursplan"), ...groups.KP.map(toChip),
      groupTitle("Teamtraining"), ...groups.TT.map(toChip),
    );
  }

  function checkedValues(container) {
    return [...container.querySelectorAll("input:checked")].map((i) => i.value);
  }

  // Fills the settings screen and calls onChange with the new settings on every edit.
  // els: { studios, courses, dayTimes, showBauch }; dayTimes is filled by days.js.
  function bind(els, schedule, settings, onChange) {
    renderStudios(els.studios, schedule, settings);
    renderCourses(els.courses, schedule, settings);
    els.showBauch.checked = settings.showBauch;
    let dayTimes = { time: settings.time, days: settings.days };
    const update = () => {
      const next = {
        studios: checkedValues(els.studios),
        courses: checkedValues(els.courses),
        ...dayTimes,
        showBauch: els.showBauch.checked,
      };
      save(next);
      onChange(next);
    };
    DayTimes.bind(els.dayTimes, settings, (next) => { dayTimes = next; update(); });
    els.studios.onchange = update;
    els.courses.onchange = update;
    els.showBauch.onchange = update;
  }

  return { load, save, prune, bind, isEmpty, normalize, fromV1, validTime };
})();

if (typeof module !== "undefined") module.exports = Settings;
