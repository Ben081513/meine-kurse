// One color per chosen studio, used by the day list and the PDF. Colors follow
// the alphabetical order of the chosen studios, so the same choice always
// gives the same colors.
const StudioColors = (() => {
  // fill: soft background, border: the studio's marker color, text: readable on fill.
  const PALETTE = [
    { fill: "#d9ead3", border: "#6aa84f", text: "#274e13" }, // green
    { fill: "#f4cccc", border: "#cc0000", text: "#660000" }, // red
    { fill: "#cfe2f3", border: "#3d85c6", text: "#0b3d6b" }, // blue
    { fill: "#fce5cd", border: "#e69138", text: "#783f04" }, // orange
    { fill: "#d9d2e9", border: "#8e7cc3", text: "#20124d" }, // purple
    { fill: "#d0e8e8", border: "#45818e", text: "#0c343d" }, // teal
    { fill: "#fff2cc", border: "#bf9000", text: "#5c4700" }, // yellow
    { fill: "#ead1dc", border: "#c27ba0", text: "#4c1130" }, // pink
    { fill: "#e6dcd3", border: "#8d6e63", text: "#3e2723" }, // brown
    { fill: "#d6dcf5", border: "#3f51b5", text: "#1a237e" }, // indigo
    { fill: "#e8ecc9", border: "#8a9a1b", text: "#3b4208" }, // olive
    { fill: "#e3e3e3", border: "#888888", text: "#222222" }, // gray
  ];

  // Chosen studios in display order, each with its color: [{ studio, color }].
  function forSelection(schedule, settings) {
    const chosen = new Set(settings.studios);
    return schedule.studios
      .filter((s) => chosen.has(s.slug))
      .sort((a, b) => Schedule.collator.compare(a.name, b.name))
      .map((studio, i) => ({ studio, color: PALETTE[i % PALETTE.length] }));
  }

  function bySlug(schedule, settings) {
    return new Map(forSelection(schedule, settings).map((x) => [x.studio.slug, x.color]));
  }

  return { forSelection, bySlug };
})();

if (typeof module !== "undefined") module.exports = StudioColors;
