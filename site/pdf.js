// Builds the PDF export: phone-sized pages (iPhone screen, 390 × 844 pt), one
// dark bar per day, each class in its studio's color and a legend at the end.
// Uses the bundled jsPDF library (vendor/jspdf.umd.min.js).
const PlanPdf = (() => {
  const PAGE = { w: 390, h: 844, margin: 14 };
  const TIME_W = 82;
  const GAP = 4;
  const DARK = "#333333";
  const MUTED = "#666666";
  const MONDAY = new Date(2024, 0, 1); // any Monday: the PDF always runs Mo–So

  function startPage(doc, state) {
    if (state.y !== null) doc.addPage([PAGE.w, PAGE.h]);
    state.y = PAGE.margin;
  }

  // Starts a new page when the next block would not fit.
  function ensure(doc, state, height, dayName) {
    if (state.y + height <= PAGE.h - PAGE.margin) return;
    startPage(doc, state);
    if (dayName) dayBar(doc, state, `${dayName} (Fortsetzung)`);
  }

  function bar(doc, state, height, size) {
    const x = PAGE.margin;
    const w = PAGE.w - 2 * PAGE.margin;
    doc.setFillColor(DARK);
    doc.roundedRect(x, state.y, w, height, 4, 4, "F");
    doc.setFont("helvetica", "bold").setFontSize(size).setTextColor("#ffffff");
    return { x, w, mid: state.y + height / 2 };
  }

  function titleBar(doc, state) {
    const b = bar(doc, state, 30, 15);
    doc.text("Meine Kurse (Mo–So)", b.x + b.w / 2, b.mid, { align: "center", baseline: "middle" });
    state.y += 36;
  }

  function dayBar(doc, state, name) {
    const b = bar(doc, state, 20, 11);
    doc.text(name, b.x + 8, b.mid, { baseline: "middle" });
    state.y += 20 + GAP;
  }

  function smallLines(doc, state, lines) {
    doc.setFont("helvetica", "normal").setFontSize(8).setTextColor(MUTED);
    const wrapped = doc.splitTextToSize(lines.join("\n"), PAGE.w - 2 * PAGE.margin);
    doc.text(wrapped, PAGE.margin, state.y + 7);
    state.y += wrapped.length * 10 + 6;
  }

  function bauchText(bauch) {
    const parts = [];
    if (bauch.before) parts.push(`${bauch.before.name} davor ${bauch.before.start}`);
    if (bauch.after) parts.push(`${bauch.after.name} danach ${bauch.after.start}`);
    return parts.length ? `+ ${parts.join(" · ")}` : "";
  }

  // The text of one class box: course and studio, then the bauch hint if wanted.
  function entryLines(doc, entry, settings, width) {
    const unsure = entry.cls.sure === false ? " (Name unsicher)" : "";
    doc.setFont("helvetica", "bold").setFontSize(10);
    const main = doc.splitTextToSize(`${entry.cls.name} · ${entry.studio.name}${unsure}`, width);
    const hint = settings.showBauch ? bauchText(entry.bauch) : "";
    doc.setFont("helvetica", "normal").setFontSize(8.5);
    const extra = hint ? doc.splitTextToSize(hint, width) : [];
    return { main, extra, height: 10 + main.length * 12 + extra.length * 10.5 };
  }

  function entryRow(doc, state, entry, ctx) {
    const boxX = PAGE.margin + TIME_W + GAP;
    const boxW = PAGE.w - PAGE.margin - boxX;
    const lines = entryLines(doc, entry, ctx.settings, boxW - 12);
    ensure(doc, state, lines.height + GAP, ctx.dayName);
    const y = state.y;
    doc.setFillColor("#eeeeee").roundedRect(PAGE.margin, y, TIME_W, lines.height, 3, 3, "F");
    doc.setFont("helvetica", "bold").setFontSize(10).setTextColor("#111111");
    doc.text(`${entry.cls.start}–${entry.cls.end}`, PAGE.margin + TIME_W / 2, y + 15, { align: "center" });
    const c = ctx.colors.get(entry.studio.slug);
    doc.setFillColor(c.fill).setDrawColor(c.border).setLineWidth(1.2);
    doc.roundedRect(boxX, y, boxW, lines.height, 3, 3, "FD");
    doc.setTextColor(c.text).text(lines.main, boxX + 6, y + 15);
    doc.setFont("helvetica", "normal").setFontSize(8.5);
    doc.text(lines.extra, boxX + 6, y + 15 + lines.main.length * 12);
    state.y += lines.height + GAP;
  }

  function daySection(doc, state, day, ctx) {
    ensure(doc, state, 20 + GAP + 30);
    dayBar(doc, state, day.name);
    if (!day.entries.length) {
      doc.setFont("helvetica", "normal").setFontSize(9).setTextColor(MUTED);
      doc.text("Nichts Passendes", PAGE.margin + 8, state.y + 9);
      state.y += 16;
    }
    for (const entry of day.entries) entryRow(doc, state, entry, { ...ctx, dayName: day.name });
    state.y += 6;
  }

  function legend(doc, state, studios) {
    ensure(doc, state, 26);
    let x = PAGE.margin;
    doc.setFont("helvetica", "bold").setFontSize(9).setLineWidth(1.2);
    for (const { studio, color } of studios) {
      const w = doc.getTextWidth(studio.name) + 16;
      if (x + w > PAGE.w - PAGE.margin) {
        x = PAGE.margin;
        state.y += 24;
        ensure(doc, state, 26);
      }
      doc.setFillColor(color.fill).setDrawColor(color.border);
      doc.roundedRect(x, state.y + 4, w, 18, 3, 3, "FD");
      doc.setTextColor(color.text).text(studio.name, x + 8, state.y + 16.5);
      x += w + 8;
    }
    state.y += 26;
  }

  // header: the lines shown under the title (plan date, chosen search).
  function build(schedule, settings, header) {
    const doc = new window.jspdf.jsPDF({ unit: "pt", format: [PAGE.w, PAGE.h] });
    doc.setProperties({ title: "Meine Kurse" });
    const studios = StudioColors.forSelection(schedule, settings);
    const ctx = { settings, colors: new Map(studios.map((s) => [s.studio.slug, s.color])) };
    const state = { y: null };
    startPage(doc, state);
    titleBar(doc, state);
    smallLines(doc, state, header);
    for (const day of Schedule.buildDays(schedule, settings, MONDAY)) daySection(doc, state, day, ctx);
    legend(doc, state, studios);
    return doc;
  }

  return { build };
})();
