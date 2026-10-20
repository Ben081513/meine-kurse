// The user's choice of studios, courses and time windows: kept in localStorage
// and edited on the settings screen.
const Settings = (() => {
  const KEY = "meine-kurse:settings:v1";
  const GROUPS = ["weekday", "weekend"];
  const EDGES = ["from", "to"];
  const DEFAULTS = {
    studios: [],
    courses: [],
    windows: {
      weekday: { from: "00:00", to: "23:59" },
      weekend: { from: "00:00", to: "23:59" },
    },
    showBauch: true,
  };

  function validTime(value, fallback) {
    return /^([01]\d|2[0-3]):[0-5]\d$/.test(value || "") ? value : fallback;
  }

  function strings(list) {
    return Array.isArray(list) ? list.filter((x) => typeof x === "string") : [];
  }

  function normalize(raw) {
    const s = structuredClone(DEFAULTS);
    if (!raw || typeof raw !== "object") return s;
    s.studios = strings(raw.studios);
    s.courses = strings(raw.courses);
    if (typeof raw.showBauch === "boolean") s.showBauch = raw.showBauch;
    for (const group of GROUPS) {
      const w = raw.windows && raw.windows[group];
      for (const edge of EDGES) s.windows[group][edge] = validTime(w && w[edge], s.windows[group][edge]);
    }
    return s;
  }

  function load() {
    try {
      return normalize(JSON.parse(localStorage.getItem(KEY)));
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

  // Reads the time fields; an emptied field gets its default back, visibly.
  function readWindows(windowEls) {
    const windows = {};
    for (const group of GROUPS) {
      windows[group] = {};
      for (const edge of EDGES) {
        const input = windowEls[group][edge];
        input.value = validTime(input.value, DEFAULTS.windows[group][edge]);
        windows[group][edge] = input.value;
      }
      windowEls[group].warn.hidden = Schedule.isWindowValid(windows[group]);
    }
    return windows;
  }

  // Fills the settings screen and calls onChange with the new settings on every edit.
  // els: { studios, courses, windows: { weekday|weekend: { from, to, warn } }, showBauch }
  function bind(els, schedule, settings, onChange) {
    renderStudios(els.studios, schedule, settings);
    renderCourses(els.courses, schedule, settings);
    els.showBauch.checked = settings.showBauch;
    for (const group of GROUPS) {
      for (const edge of EDGES) els.windows[group][edge].value = settings.windows[group][edge];
    }
    readWindows(els.windows);
    const update = () => {
      const next = {
        studios: checkedValues(els.studios),
        courses: checkedValues(els.courses),
        windows: readWindows(els.windows),
        showBauch: els.showBauch.checked,
      };
      save(next);
      onChange(next);
    };
    els.studios.onchange = update;
    els.courses.onchange = update;
    els.showBauch.onchange = update;
    for (const group of GROUPS) {
      for (const edge of EDGES) els.windows[group][edge].onchange = update;
    }
  }

  return { load, save, prune, bind, isEmpty, normalize };
})();

if (typeof module !== "undefined") module.exports = Settings;
