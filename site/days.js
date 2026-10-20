// The "Tage & Uhrzeit" block on the settings screen: which days are training
// days, the shared time, and an own time for single days that differ.
// Layout and states: slice detail "days-design" of plan f002.
const DayTimes = (() => {
  const DAYS = [1, 2, 3, 4, 5, 6, 7];
  const SHORT = ["", "Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];
  const WARN_TEXT = "„bis“ muss nach „von“ liegen, sonst wird nichts angezeigt.";

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function button(className, text, onClick) {
    const b = el("button", className, text);
    b.type = "button";
    b.onclick = onClick;
    return b;
  }

  // von/bis fields; an emptied field gets the fallback back, visibly.
  function timeFields(value, fallback, onChange) {
    const row = el("div", "window");
    const warn = el("p", "window-warn", WARN_TEXT);
    const inputs = ["from", "to"].map((edge) => {
      const input = el("input");
      input.type = "time";
      input.value = value[edge];
      const label = el("label", "", edge === "from" ? "von " : "bis ");
      label.append(input);
      row.append(label);
      return input;
    });
    const read = () => {
      const [from, to] = inputs.map((input, i) => {
        input.value = Settings.validTime(input.value, fallback[i ? "to" : "from"]);
        return input.value;
      });
      return { from, to };
    };
    const check = (w) => { warn.hidden = Schedule.isWindowValid(w); };
    for (const input of inputs) input.onchange = () => { const w = read(); check(w); onChange(w); };
    check(value);
    return { row, warn, set(w) { inputs[0].value = w.from; inputs[1].value = w.to; check(w); } };
  }

  // container: an empty element inside the fieldset. onChange gets { time, days }.
  function bind(container, settings, onChange) {
    const state = { time: { ...settings.time }, days: structuredClone(settings.days), open: false };
    const active = (day) => state.days[day] !== false;
    const own = (day) => typeof state.days[day] === "object";
    const changed = () => {
      refresh();
      onChange({ time: { ...state.time }, days: structuredClone(state.days) });
    };

    const dayButtons = DAYS.map((day) => button("day-btn", SHORT[day], () => {
      state.days[day] = active(day) ? false : true;
      renderRows();
      changed();
    }));
    dayButtons.forEach((b, i) => b.setAttribute("aria-label", Schedule.DAY_NAMES[i + 1]));
    const dayRow = el("div", "day-row");
    dayRow.setAttribute("role", "group");
    dayRow.setAttribute("aria-label", "Trainingstage");
    dayRow.append(...dayButtons);

    const pick = (days) => () => {
      for (const day of DAYS) {
        if (!days.includes(day)) state.days[day] = false;
        else if (!active(day)) state.days[day] = true;
      }
      renderRows();
      changed();
    };
    const quick = el("div", "quick");
    quick.append(button("mini-btn", "Alle", pick(DAYS)), button("mini-btn", "Mo–Fr", pick([1, 2, 3, 4, 5])));
    const noneWarn = el("p", "window-warn", "Wähle mindestens einen Tag.");

    const global = timeFields(state.time, { from: "00:00", to: "23:59" }, (w) => {
      state.time = w;
      renderRows();
      changed();
    });

    const toggle = el("button", "disclosure");
    toggle.type = "button";
    const toggleTitle = el("strong", "", "Einzelne Tage anders");
    const summary = el("small");
    const text = el("span");
    text.append(toggleTitle, summary);
    const chev = el("span", "chev");
    chev.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 18 6-6-6-6"/></svg>';
    toggle.append(text, chev);
    toggle.onclick = () => { state.open = !state.open; refresh(); };
    const rows = el("div", "perday");
    rows.id = "perday-rows";
    toggle.setAttribute("aria-controls", rows.id);

    function row(day) {
      const box = el("div", "perday-row");
      const top = el("div", "perday-top");
      const value = el("span", own(day) ? "perday-val own" : "perday-val",
        own(day) ? `${state.days[day].from}–${state.days[day].to}` : `wie oben, ${state.time.from}–${state.time.to}`);
      top.append(el("span", "perday-name", SHORT[day]), value);
      if (!own(day)) {
        top.append(button("link-btn", "ändern", () => { state.days[day] = { ...state.time }; renderRows(); changed(); }));
        box.append(top);
        return box;
      }
      top.append(button("link-btn", "zurück auf Standard", () => { state.days[day] = true; renderRows(); changed(); }));
      const fields = timeFields(state.days[day], state.time, (w) => {
        state.days[day] = w;
        value.textContent = `${w.from}–${w.to}`;
        changed();
      });
      box.append(top, fields.row, fields.warn);
      return box;
    }

    function renderRows() {
      rows.replaceChildren(...DAYS.filter(active).map(row));
    }

    function refresh() {
      dayButtons.forEach((b, i) => {
        b.classList.toggle("on", active(i + 1));
        b.setAttribute("aria-pressed", String(active(i + 1)));
      });
      const on = DAYS.filter(active);
      noneWarn.hidden = on.length > 0;
      const differs = on.filter(own);
      summary.textContent = differs.length
        ? `${differs.map((d) => SHORT[d]).join(", ")} mit eigener Zeit`
        : "Alle Tage wie oben";
      summary.className = differs.length ? "differs" : "";
      toggle.setAttribute("aria-expanded", String(state.open));
      rows.hidden = !state.open;
    }

    container.replaceChildren(
      el("p", "group-title", "Trainingstage"), dayRow, quick, noneWarn,
      el("p", "group-title", "Uhrzeit (gilt für alle Tage)"), global.row, global.warn,
      toggle, rows,
    );
    renderRows();
    refresh();
  }

  // One line for the PDF header, e.g. "Di, Mi, Sa · 16:00–23:59 · Mi ab 18:00".
  function summary(settings) {
    const on = DAYS.filter((day) => settings.days[day] !== false);
    const t = settings.time;
    const parts = [
      on.length === 7 ? "Mo–So" : on.map((d) => SHORT[d]).join(", "),
      `${t.from}–${t.to}`,
    ];
    for (const day of on) {
      const w = settings.days[day];
      if (typeof w !== "object") continue;
      parts.push(w.to === t.to ? `${SHORT[day]} ab ${w.from}` : `${SHORT[day]} ${w.from}–${w.to}`);
    }
    return parts.join(" · ");
  }

  return { bind, summary };
})();

if (typeof module !== "undefined") module.exports = DayTimes;
