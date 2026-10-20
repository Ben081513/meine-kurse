// The "Tage & Uhrzeit" block on the settings screen: which days are training
// days, the shared time, and an own time for single days that differ.
// Layout and states: slice detail "days-design" of plan f002.
const DayTimes = (() => {
  const DAYS = [1, 2, 3, 4, 5, 6, 7];
  const WEEKDAYS = [1, 2, 3, 4, 5];
  const SHORT = ["", "Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];
  const ALL_DAY = { from: "00:00", to: "23:59" };
  const WARN_TEXT = "„bis“ muss nach „von“ liegen, sonst wird nichts angezeigt.";
  const CHEVRON = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 18 6-6-6-6"/></svg>';

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

  function sameTime(a, b) {
    return a.from === b.from && a.to === b.to;
  }

  // von/bis fields; an emptied field gets the fallback back, visibly.
  // name: what VoiceOver reads before "von"/"bis", so the seven rows differ.
  function timeFields(value, fallback, name, onChange) {
    const row = el("div", "window");
    const warn = el("p", "window-warn", WARN_TEXT);
    const inputs = ["from", "to"].map((edge) => {
      const input = el("input");
      input.type = "time";
      input.value = value[edge];
      input.setAttribute("aria-label", `${name} ${edge === "from" ? "von" : "bis"}`);
      const label = el("label", "", edge === "from" ? "von " : "bis ");
      label.append(input);
      row.append(label);
      return input;
    });
    const read = () => ({
      from: inputs[0].value = Settings.validTime(inputs[0].value, fallback.from),
      to: inputs[1].value = Settings.validTime(inputs[1].value, fallback.to),
    });
    const check = (w) => { warn.hidden = Schedule.isWindowValid(w); };
    for (const input of inputs) input.onchange = () => { const w = read(); check(w); onChange(w); };
    check(value);
    return [row, warn];
  }

  // Holds the choice while the screen is open; every edit goes through changed().
  function model(settings, onChange) {
    const state = { time: { ...settings.time }, days: structuredClone(settings.days) };
    return {
      state,
      isActive: (day) => state.days[day] !== false,
      hasOwn: (day) => typeof state.days[day] === "object",
      changed: () => onChange({ time: { ...state.time }, days: structuredClone(state.days) }),
    };
  }

  function dayButtons(m, onEdit) {
    const buttons = DAYS.map((day) => {
      const b = button("day-btn", SHORT[day], () => {
        m.state.days[day] = !m.isActive(day);
        onEdit();
      });
      b.setAttribute("aria-label", Schedule.DAY_NAMES[day]);
      return b;
    });
    const row = el("div", "day-row");
    row.setAttribute("role", "group");
    row.setAttribute("aria-label", "Trainingstage");
    row.append(...buttons);
    const refresh = () => buttons.forEach((b, i) => {
      b.classList.toggle("on", m.isActive(i + 1));
      b.setAttribute("aria-pressed", String(m.isActive(i + 1)));
    });
    return { row, refresh };
  }

  // "Alle" and "Mo–Fr". Days that stay on keep their own time.
  function quickPicks(m, onEdit) {
    const pick = (days) => () => {
      for (const day of DAYS) {
        if (!days.includes(day)) m.state.days[day] = false;
        else if (!m.isActive(day)) m.state.days[day] = true;
      }
      onEdit();
    };
    const box = el("div", "quick");
    box.append(button("mini-btn", "Alle", pick(DAYS)), button("mini-btn", "Mo–Fr", pick(WEEKDAYS)));
    return box;
  }

  // One row per active day. Switching a day off forgets its own time on purpose:
  // switched on again it starts from the shared time, as a fresh day would.
  function perDayRow(day, m, onEdit) {
    const own = m.hasOwn(day);
    const t = own ? m.state.days[day] : m.state.time;
    const box = el("div", "perday-row");
    box.dataset.day = day;
    const top = el("div", "perday-top");
    const value = el("span", own ? "perday-val own" : "perday-val",
      own ? `${t.from}–${t.to}` : `wie oben, ${t.from}–${t.to}`);
    const action = own
      ? button("link-btn", "zurück auf Standard", () => { m.state.days[day] = true; onEdit(day); })
      : button("link-btn", "ändern", () => { m.state.days[day] = { ...m.state.time }; onEdit(day); });
    top.append(el("span", "perday-name", SHORT[day]), value, action);
    box.append(top);
    if (!own) return box;
    box.append(...timeFields(t, m.state.time, Schedule.DAY_NAMES[day], (w) => {
      m.state.days[day] = w;
      value.textContent = `${w.from}–${w.to}`;
      m.changed();
    }));
    return box;
  }

  // "Einzelne Tage anders": collapsed by default, its subtitle says which days differ.
  function disclosure() {
    const toggle = el("button", "disclosure");
    toggle.type = "button";
    const subtitle = el("small");
    const text = el("span");
    text.append(el("strong", "", "Einzelne Tage anders"), subtitle);
    const chev = el("span", "chev");
    chev.innerHTML = CHEVRON;
    toggle.append(text, chev);
    const rows = el("div", "perday");
    rows.id = "perday-rows";
    toggle.setAttribute("aria-controls", rows.id);
    return { toggle, subtitle, rows };
  }

  // container: an empty element inside the fieldset. onChange gets { time, days }.
  function bind(container, settings, onChange) {
    const m = model(settings, onChange);
    let isOpen = false;
    const days = dayButtons(m, () => edit());
    const noneWarn = el("p", "window-warn", "Wähle mindestens einen Tag.");
    noneWarn.setAttribute("role", "status");
    const shared = timeFields(m.state.time, ALL_DAY, "Alle Tage", (w) => { m.state.time = w; edit(); });
    const more = disclosure();
    more.toggle.onclick = () => { isOpen = !isOpen; refresh(); };

    // Rebuilding the rows drops the tapped button, so focus moves to the same day's new row.
    function edit(focusDay) {
      more.rows.replaceChildren(...DAYS.filter(m.isActive).map((day) => perDayRow(day, m, edit)));
      refresh();
      m.changed();
      if (focusDay) more.rows.querySelector(`[data-day="${focusDay}"] .link-btn`).focus();
    }

    function refresh() {
      days.refresh();
      const on = DAYS.filter(m.isActive);
      noneWarn.hidden = on.length > 0;
      const differs = on.filter(m.hasOwn);
      more.subtitle.textContent = differs.length
        ? `${differs.map((d) => SHORT[d]).join(", ")} mit eigener Zeit`
        : "Alle Tage wie oben";
      more.subtitle.className = differs.length ? "differs" : "";
      more.toggle.setAttribute("aria-expanded", String(isOpen));
      more.rows.hidden = !isOpen;
    }

    container.replaceChildren(
      el("p", "group-title", "Trainingstage"), days.row, quickPicks(m, () => edit()), noneWarn,
      el("p", "group-title", "Uhrzeit (gilt für alle Tage)"), ...shared,
      more.toggle, more.rows,
    );
    more.rows.replaceChildren(...DAYS.filter(m.isActive).map((day) => perDayRow(day, m, edit)));
    refresh();
  }

  function dayList(on) {
    if (on.length === DAYS.length) return "Mo–So";
    if (on.join() === WEEKDAYS.join()) return "Mo–Fr";
    return on.map((d) => SHORT[d]).join(", ");
  }

  // One line for the PDF header, e.g. "Di, Mi, Sa · 16:00–23:59 · Mi ab 18:00".
  function summary(settings) {
    const on = DAYS.filter((day) => settings.days[day] !== false);
    if (!on.length) return "Keine Trainingstage gewählt";
    const t = settings.time;
    const parts = [dayList(on), `${t.from}–${t.to}`];
    for (const day of on) {
      const w = settings.days[day];
      if (typeof w !== "object" || sameTime(w, t)) continue;
      parts.push(w.to === t.to ? `${SHORT[day]} ab ${w.from}` : `${SHORT[day]} ${w.from}–${w.to}`);
    }
    return parts.join(" · ");
  }

  return { bind, summary };
})();

if (typeof module !== "undefined") module.exports = DayTimes;
