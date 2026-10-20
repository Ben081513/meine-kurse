"""Turn a Superfit plan PDF into a list of classes.

Every class cell on a plan reads

    LESMILLS / SUPERFIT / TEAMTRAINING    brand line, ignored
    BODYPUMP HEAVY                        course name (may carry a WOMEN badge)
    20:00 - 20:50                         time

The times are real text in the PDF and are taken from its text layer, which
is exact even where a cell is partly covered by the next one (a PDF without
text falls back to the recognized times). The weekday header MONTAG ... SONNTAG
gives the seven day columns. The course names are pictures: for every time,
the strip above it (brand and name, without the course logo on the left) is
read on its own with Apple Vision, and the lowest non-brand line is the name.
The name is then matched against scraper/known_courses.json.
"""
import difflib
import json
import re
import subprocess
from pathlib import Path

HERE = Path(__file__).resolve().parent
KNOWN_COURSES = HERE / "known_courses.json"
WEEKDAYS = ["MONTAG", "DIENSTAG", "MITTWOCH", "DONNERSTAG", "FREITAG", "SAMSTAG", "SONNTAG"]
BRANDS = ["LESMILLS", "SUPERFIT", "TEAMTRAINING", "ZUMBA FITNESS"]
TIME = re.compile(r"^(\d{1,2})[:.](\d{2})\s*[-–]\s*(\d{1,2})[:.](\d{2})$")
LOOSE_TIME = re.compile(r"\d{1,2}[:.]\d{2}\s*[-–]\s*\d{1,2}[:.]\d{2}")
DIGIT_LOOKALIKES =str.maketrans({"O": "0", "o": "0", "l": "1", "I": "1", "L": "1"})

CELL_REACH = 30     # pt above a time that belong to its cell (brand + name)
CELL_MARGIN = 3     # pt kept clear of the cell's right edge
SAME_LINE = 4       # pt difference in y for boxes on one text line
CELL_SCALE = 8      # render resolution for the cell strips
SURE_RATIO = 0.85   # name similarity needed to call a match certain
MATCH_RATIO = 0.6   # below this the raw text is kept as the name


class ParseError(Exception):
    """The PDF does not look like a Superfit plan (any more)."""


def run_ocr(ocr_bin, pdf, *extra):
    out = subprocess.run([str(ocr_bin), str(pdf), *extra], capture_output=True, text=True)
    if out.returncode != 0:
        raise ParseError(f"OCR failed for {pdf}: {out.stderr.strip()}")
    return json.loads(out.stdout)


def parse_time(text):
    """'18:00 -18:20' -> ('18:00', '18:20'), or None if it is no time range."""
    m = TIME.match(text.strip().translate(DIGIT_LOOKALIKES))
    if not m:
        return None
    h1, m1, h2, m2 = (int(g) for g in m.groups())
    if not (0 <= h1 < 24 and 0 <= h2 < 24 and m1 < 60 and m2 < 60):
        return None
    return f"{h1:02d}:{m1:02d}", f"{h2:02d}:{m2:02d}"


def timed(boxes):
    """(box, (start, end)) for the boxes that hold a time range."""
    return [(b, span) for b in boxes for span in [parse_time(b["text"])] if span]


def find_columns(page):
    """x ranges of the seven day columns, from the weekday header."""
    headers = {}
    for box in page["boxes"]:
        word = box["text"].strip().upper()
        if word in WEEKDAYS and word not in headers:
            headers[word] = box
    missing = [d for d in WEEKDAYS if d not in headers]
    if missing:
        raise ParseError(f"weekday header not found: {', '.join(missing)}")
    lefts = [headers[d]["x"] for d in WEEKDAYS]
    if lefts != sorted(lefts):
        raise ParseError("weekday columns are not in order Monday to Sunday")
    pitch = (lefts[-1] - lefts[0]) / 6
    return [(left, left + pitch) for left in lefts]


def page_time_count(page):
    """How many time ranges Vision sees on the page, even inside logo noise."""
    return sum(bool(LOOSE_TIME.search(b["text"])) for b in page["boxes"])


def place_times(page, columns):
    """(day, time box, span) for every time on the page, in reading order."""
    exact, seen = timed(page.get("textTimes", [])), page_time_count(page)
    if exact and seen > len(exact) + 1:  # one may be unreadable for Vision
        raise ParseError(f"PDF text holds {len(exact)} times, the page shows {seen}")
    times = exact or timed(page["boxes"])
    placed = []
    for box, span in times:
        days = [d for d, (left, right) in enumerate(columns, 1) if left - 2 <= box["x"] < right - 2]
        if days:
            placed.append((days[0], box, span))
    return sorted(placed, key=lambda t: (t[0], t[1]["y"]))


def cell_crop(box, right):
    """The strip above a time holding brand and name, as an --crop value."""
    x, y = box["x"] - 2, box["y"] - CELL_REACH
    return f"{x:.1f},{y:.1f},{right - CELL_MARGIN - x:.1f},{CELL_REACH + 1:.1f}"


def text_lines(boxes):
    """Group boxes into lines (top to bottom), each joined left to right."""
    lines = []
    for box in sorted(boxes, key=lambda b: b["y"]):
        if lines and abs(lines[-1][0]["y"] - box["y"]) <= SAME_LINE:
            lines[-1].append(box)
        else:
            lines.append([box])
    return [{"text": " ".join(b["text"].strip() for b in sorted(line, key=lambda b: b["x"])),
             "conf": min(b["conf"] for b in line)} for line in lines]


def is_brand(text):
    best = max(difflib.SequenceMatcher(None, text.upper(), b).ratio() for b in BRANDS)
    return best >= 0.75


def name_line(boxes):
    """The course name among the lines of one cell strip, or None."""
    lines = [ln for ln in text_lines(boxes)
             if sum(ch.isalpha() for ch in ln["text"]) >= 2 and not is_brand(ln["text"])]
    return lines[-1] if lines else None


def load_known():
    return json.loads(KNOWN_COURSES.read_text(encoding="utf-8"))


def match_name(raw, conf, known):
    """Map OCR text to a known course name; returns (name, sure)."""
    key = re.sub(r"\s+", " ", raw.upper()).strip()
    if key in known:
        return known[key], True
    found = difflib.get_close_matches(key, known.keys(), n=1, cutoff=MATCH_RATIO)
    if not found:
        return raw.strip().title(), False
    ratio = difflib.SequenceMatcher(None, key, found[0]).ratio()
    return known[found[0]], ratio >= SURE_RATIO and conf >= 0.5


def read_names(ocr_bin, pdf, page, cells):
    """One name line (or None) per cell, read in a single OCR call."""
    if not cells:
        return []
    args = []
    for _, crop in cells:
        args += ["--crop", crop]
    result = run_ocr(ocr_bin, pdf, *args, "--scale", str(CELL_SCALE),
                     "--orientation", page["orientation"])
    by_region = [[] for _ in cells]
    for box in result["boxes"]:
        by_region[box["region"]].append(box)
    return [name_line(boxes) for boxes in by_region]


def parse_plan(ocr_bin, pdf, plan):
    """All classes in one plan PDF; plan is 'KP' or 'TT'."""
    known = load_known()[plan]
    page = run_ocr(ocr_bin, pdf)
    columns = find_columns(page)
    placed = place_times(page, columns)
    cells = [((day, span), cell_crop(box, columns[day - 1][1])) for day, box, span in placed]
    classes = []
    for ((day, (start, end)), _), line in zip(cells, read_names(ocr_bin, pdf, page, cells)):
        raw = line["text"] if line else ""
        name, sure = match_name(raw, line["conf"] if line else 0, known)
        classes.append({"day": day, "start": start, "end": end, "name": name,
                        "plan": plan, "raw": raw, "sure": sure and bool(raw)})
    return classes


if __name__ == "__main__":
    import sys
    ocr = HERE.parent / "data" / "bin" / "ocr"
    for entry in parse_plan(ocr, sys.argv[1], sys.argv[2]):
        print(json.dumps(entry, ensure_ascii=False))
