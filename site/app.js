// Wires the page together: loads the schedule, shows the day list and the settings screen.
(() => {
  const $ = (id) => document.getElementById(id);
  const els = {
    list: $("list"),
    stand: $("stand"),
    settings: $("settings"),
    open: $("open-settings"),
    close: $("close-settings"),
    pdf: $("export-pdf"),
  };
  let schedule = null;
  let settings = Settings.load();
  let shownDay = null;
  let colors = new Map();

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function germanDate(iso) {
    const [y, m, d] = iso.slice(0, 10).split("-");
    return `${d}.${m}.${y}`;
  }

  function showStand() {
    const chosen = new Set(settings.studios);
    const studios = schedule.studios.filter((s) => chosen.has(s.slug));
    const shown = studios.length ? studios : schedule.studios;
    const dates = [...new Set(shown.map((s) => s.validFrom).filter(Boolean))].sort();
    const parts = [];
    if (dates.length) parts.push(`Stand: Plan gültig ab ${dates.map(germanDate).join(" / ")}`);
    const checked = new Date(schedule.updated);
    if (!Number.isNaN(checked.getTime())) {
      parts.push(`geprüft ${checked.toLocaleString("de-DE", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}`);
    }
    els.stand.textContent = parts.join(" · ");
  }

  // The lines under the PDF title: plan date and which search it shows.
  function pdfHeader() {
    const w = settings.windows;
    return [
      els.stand.textContent,
      `Kurse: ${settings.courses.map(Schedule.shortName).join(", ")}`,
      `Mo–Fr ${w.weekday.from}–${w.weekday.to} · Sa–So ${w.weekend.from}–${w.weekend.to}`,
    ];
  }

  // On the iPhone the share sheet offers "In Dateien sichern"; elsewhere it downloads.
  async function exportPdf() {
    let blob;
    try {
      blob = PlanPdf.build(schedule, settings, pdfHeader()).output("blob");
    } catch (err) {
      console.error("PDF konnte nicht erstellt werden", err);
      alert("Das PDF konnte nicht erstellt werden.");
      return;
    }
    const file = new File([blob], "meine-kurse.pdf", { type: "application/pdf" });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      navigator.share({ files: [file], title: "Meine Kurse" })
        .catch((err) => { if (err.name !== "AbortError") console.warn("Teilen fehlgeschlagen", err); });
      return;
    }
    const link = el("a");
    link.href = URL.createObjectURL(blob);
    link.download = file.name;
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 10000);
  }

  // Which color stands for which studio, above the list.
  function legend() {
    const box = el("div", "legend");
    for (const { studio, color } of StudioColors.forSelection(schedule, settings)) {
      const item = el("span", "legend-item", studio.name);
      item.style.setProperty("--studio", color.border);
      item.style.setProperty("--studio-fill", color.fill);
      item.style.setProperty("--studio-text", color.text);
      box.append(item);
    }
    return box;
  }

  function badge(text, extra) {
    return el("span", extra ? `badge ${extra}` : "badge", text);
  }

  function entryRow({ cls, studio, bauch }) {
    const li = el("li", "entry");
    const color = colors.get(studio.slug);
    li.style.setProperty("--studio", color.border);
    li.style.setProperty("--studio-fill", color.fill);
    li.style.setProperty("--studio-text", color.text);
    const time = el("div", "time", cls.start);
    time.append(el("small", "", `bis ${cls.end}`));
    const info = el("div");
    info.append(el("div", "course", cls.name), el("div", "studio", studio.name));
    const badges = el("div", "badges");
    // The full name says which kind it is: "Bauch Express" or "Teamtraining Bauch".
    if (settings.showBauch && bauch.before) badges.append(badge(`${bauch.before.name} davor ${bauch.before.start}`));
    if (settings.showBauch && bauch.after) badges.append(badge(`${bauch.after.name} danach ${bauch.after.start}`));
    if (cls.sure === false) badges.append(badge(`Name unsicher (gelesen: ${cls.raw})`, "unsure"));
    if (badges.childElementCount) info.append(badges);
    li.append(time, info);
    return li;
  }

  function daySection(day) {
    const section = el("section", "day");
    const title = el("h2");
    if (day.isToday) title.append(el("span", "today", "Heute"), " · ");
    title.append(day.name);
    section.append(title);
    if (!day.entries.length) {
      section.append(el("p", "none", "Nichts Passendes"));
    } else {
      const ul = el("ul", "entries");
      ul.append(...day.entries.map(entryRow));
      section.append(ul);
    }
    return section;
  }

  function showError(text) {
    els.list.replaceChildren(el("p", "note error", text));
  }

  function renderList() {
    const today = new Date();
    shownDay = today.toDateString();
    try {
      showStand();
      els.pdf.disabled = Settings.isEmpty(settings);
      if (Settings.isEmpty(settings)) {
        els.list.replaceChildren(el("p", "empty", "Wähle unter „Einstellungen“ deine Studios und Kurse aus."));
        return;
      }
      const days = Schedule.buildDays(schedule, settings, today);
      colors = StudioColors.bySlug(schedule, settings);
      els.list.replaceChildren(legend(), ...days.map(daySection));
    } catch (err) {
      console.error("Liste konnte nicht angezeigt werden", err);
      showError("Der Kursplan konnte nicht angezeigt werden. Bitte später noch einmal öffnen.");
    }
  }

  function openSettings(open) {
    els.settings.hidden = !open;
    els.open.setAttribute("aria-expanded", String(open));
    els.list.inert = open;
    document.body.style.overflow = open ? "hidden" : "";
    if (open) els.close.focus();
    else els.open.focus();
  }

  function windowEls(group) {
    return { from: $(`${group}-from`), to: $(`${group}-to`), warn: $(`${group}-warn`) };
  }

  function bindSettings() {
    Settings.bind({
      studios: $("studio-chips"),
      courses: $("course-chips"),
      windows: { weekday: windowEls("weekday"), weekend: windowEls("weekend") },
      showBauch: $("show-bauch"),
    }, schedule, settings, (next) => {
      settings = next;
      renderList();
    });
    els.pdf.onclick = exportPdf;
    els.open.onclick = () => openSettings(true);
    els.close.onclick = () => openSettings(false);
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && !els.settings.hidden) openSettings(false);
    });
  }

  // iOS keeps a home-screen app suspended, so "Heute" is redrawn when it comes back on a new day.
  function watchDayChange() {
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible" && new Date().toDateString() !== shownDay) renderList();
    });
  }

  async function start() {
    try {
      const response = await fetch("data/schedule.json", { cache: "no-cache" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      schedule = Schedule.clean(await response.json());
    } catch (err) {
      console.error("Kursplan konnte nicht geladen werden", err);
      els.stand.textContent = "";
      showError("Der Kursplan konnte nicht geladen werden. Bitte später noch einmal öffnen.");
      return;
    }
    if (schedule.dropped) console.warn(`${schedule.dropped} fehlerhafte Einträge im Kursplan übersprungen`);
    settings = Settings.prune(settings, schedule);
    bindSettings();
    renderList();
    watchDayChange();
    if (Settings.isEmpty(settings)) openSettings(true);
  }

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("sw.js")
      .catch((err) => console.warn("Offline-Modus nicht verfügbar", err));
  }
  start();
})();
