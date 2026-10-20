"""Update site/data/schedule.json from the Superfit plan PDFs.

    python3 scraper/run.py

Steps: find every studio's plan PDFs (fetch.py), read the ones whose URL
changed (ocr.swift + parse.py), check the result, write schedule.json.
A plan whose URL did not change keeps its classes from the last schedule.
A plan that fails the checks keeps its old classes too, is not remembered in
data/sources.json (so the next run tries again) and makes the run exit with
an error. schedule.json is only rewritten when the classes really changed.
"""
import json
import subprocess
import sys
from datetime import datetime, timezone

import fetch
import parse

SCHEDULE = fetch.ROOT / "site" / "data" / "schedule.json"
OCR_SOURCE = fetch.ROOT / "scraper" / "ocr.swift"
OCR_BIN = fetch.DATA / "bin" / "ocr"

MIN_CLASSES = 5          # fewer classes in a plan means the layout changed
MAX_UNSURE_SHARE = 0.3   # more uncertain names means the reading went wrong
MIN_MINUTES, MAX_MINUTES = 10, 120
EARLIEST, LATEST = "06:00", "23:30"


def build_ocr():
    """Compile ocr.swift once; much faster than interpreting it per PDF."""
    if OCR_BIN.exists() and OCR_BIN.stat().st_mtime >= OCR_SOURCE.stat().st_mtime:
        return
    OCR_BIN.parent.mkdir(parents=True, exist_ok=True)
    subprocess.run(["swiftc", "-O", str(OCR_SOURCE), "-o", str(OCR_BIN)], check=True)


def minutes(hhmm):
    hours, mins = hhmm.split(":")
    return int(hours) * 60 + int(mins)


def check_plan(classes):
    """Problems that suggest the PDF was read wrongly; empty list if fine."""
    problems = []
    if len(classes) < MIN_CLASSES:
        problems.append(f"only {len(classes)} classes found")
    unsure = sum(not c["sure"] for c in classes)
    if classes and unsure / len(classes) > MAX_UNSURE_SHARE:
        problems.append(f"{unsure} of {len(classes)} course names uncertain")
    for c in classes:
        length = minutes(c["end"]) - minutes(c["start"])
        if not MIN_MINUTES <= length <= MAX_MINUTES:
            problems.append(f"day {c['day']} {c['start']}-{c['end']}: implausible length")
        if not EARLIEST <= c["start"] <= LATEST:
            problems.append(f"day {c['day']} {c['start']}: implausible start")
    return problems


def load_schedule():
    if SCHEDULE.exists():
        data = json.loads(SCHEDULE.read_text(encoding="utf-8"))
        return {s["slug"]: s for s in data["studios"]}
    return {}


def previous_classes(old_studio, kind, url):
    """Classes of one plan from the last schedule, if it came from this URL."""
    if not old_studio or url not in old_studio.get("sources", []):
        return None
    return [c for c in old_studio["classes"] if c["plan"] == kind]


def read_plan(info, kind, changed, old_studio):
    """(classes or None, problems) for one plan of one studio."""
    url = info["plans"][kind]["url"]
    kept = previous_classes(old_studio, kind, url)
    if kind not in changed and kept is not None:
        return kept, []
    pdf = fetch.download(info, kind) if kind not in changed else fetch.local_pdf(info["slug"], kind)
    try:
        classes = parse.parse_plan(OCR_BIN, pdf, kind)
    except parse.ParseError as err:
        return None, [str(err)]
    problems = check_plan(classes)
    return (None if problems else classes), problems


def build_studio(info, changed, old_studio, state):
    """Schedule entry for one studio; updates state["sources"] and state["errors"]."""
    sources, errors = state["sources"], state["errors"]
    classes, urls = [], []
    for kind in sorted(info["plans"]):
        plan = info["plans"][kind]
        got, problems = read_plan(info, kind, changed, old_studio)
        if got is None:
            errors.extend(f"{info['slug']} {kind}: {p}" for p in problems)
            got = [c for c in (old_studio or {}).get("classes", []) if c["plan"] == kind]
            old_url = next((u for u in (old_studio or {}).get("sources", []) if f"_{kind}_" in u), None)
            urls += [old_url] if old_url and got else []
        else:
            sources.setdefault(info["slug"], {"plans": {}})["plans"][kind] = plan
            urls.append(plan["url"])
        classes += got
    dates = [d for d in map(fetch.valid_from, urls) if d]
    classes.sort(key=lambda c: (c["day"], c["start"], c["plan"], c["name"]))
    return {"slug": info["slug"], "name": info["name"], "validFrom": max(dates, default=None),
            "sources": urls, "classes": classes}


def write_schedule(studios):
    """Write schedule.json unless only the timestamp would change."""
    old = json.loads(SCHEDULE.read_text(encoding="utf-8")) if SCHEDULE.exists() else {}
    if old.get("studios") == studios:
        return False
    stamp = datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")
    SCHEDULE.parent.mkdir(parents=True, exist_ok=True)
    text = json.dumps({"updated": stamp, "studios": studios}, ensure_ascii=False, indent=1)
    SCHEDULE.write_text(text + "\n", encoding="utf-8")
    return True


def main():
    build_ocr()
    found = fetch.fetch_all()
    if not found:
        print("Keine Studios mit Kursplan gefunden – Webseite geändert?", file=sys.stderr)
        return 1
    old = load_schedule()
    state = {"sources": fetch.load_sources(), "errors": []}
    studios = [build_studio(e["info"], e["changed"], old.get(slug), state) for slug, e in found.items()]
    studios.sort(key=lambda s: s["name"])
    fetch.save_sources(state["sources"])
    errors = state["errors"]
    written = write_schedule(studios)
    total = sum(len(s["classes"]) for s in studios)
    print(f"{len(studios)} Studios, {total} Kurse. schedule.json {'aktualisiert' if written else 'unverändert'}.")
    for err in errors:
        print("FEHLER:", err, file=sys.stderr)
    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main())
