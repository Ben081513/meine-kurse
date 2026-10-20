"""Find the Superfit course-plan PDFs and download only the ones that changed.

Studio pages live at https://superfit.club/studios/<slug>. Each one links a
course plan (KP_*.pdf) and a team-training plan (TT_*.pdf). The URLs seen in
the last run are kept in data/sources.json; a PDF is downloaded again only
when its URL changed (run.py saves data/sources.json after a good run).
"""
import json
import re
import urllib.parse
import urllib.request
from pathlib import Path

BASE = "https://superfit.club"
ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
PDF_DIR = DATA / "pdfs"
SOURCES = DATA / "sources.json"
USER_AGENT = "Mozilla/5.0 (superfit-kursplan)"

STUDIO_LINK = re.compile(r'href="/studios/([a-z0-9-]+)"')
PDF_LINK = re.compile(r'https://[^"\s]+?/[0-9a-f]+_((KP|TT)_[^"/\s]+?\.pdf)')
TITLE = re.compile(r"<title>SUPERFIT \| ([^|<]+)")
DATE_IN_NAME = re.compile(r"(\d{2})\.(\d{2})\.(\d{2})")


def http_get(url, timeout=30):
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return resp.read()


def studio_slugs():
    """Slugs of all studios linked from the home page, in page order."""
    html = http_get(BASE + "/").decode("utf-8", "replace")
    return list(dict.fromkeys(STUDIO_LINK.findall(html)))


def valid_from(filename):
    """'KP_MI_01.10.26.pdf' -> '2026-10-01', or None."""
    m = DATE_IN_NAME.search(filename)
    if not m:
        return None
    day, month, year = m.groups()
    return f"20{year}-{month}-{day}"


def studio_info(slug):
    """Name and plan PDFs (one per kind, KP/TT) published on a studio page."""
    html = http_get(f"{BASE}/studios/{slug}").decode("utf-8", "replace")
    title = TITLE.search(html)
    plans = {}
    for m in PDF_LINK.finditer(html):
        kind = m.group(2)
        plans.setdefault(kind, {
            "url": m.group(0),
            "file": urllib.parse.unquote(m.group(1)),
            "validFrom": valid_from(m.group(1)),
        })
    name = title.group(1).strip() if title else slug
    return {"slug": slug, "name": name, "plans": plans}


def load_sources():
    if SOURCES.exists():
        return json.loads(SOURCES.read_text(encoding="utf-8"))
    return {}


def save_sources(sources):
    DATA.mkdir(exist_ok=True)
    text = json.dumps(sources, indent=2, ensure_ascii=False, sort_keys=True)
    SOURCES.write_text(text + "\n", encoding="utf-8")


def local_pdf(slug, kind):
    return PDF_DIR / f"{slug}_{kind}.pdf"


def download(info, kind):
    """Download one plan PDF of a studio and return its local path."""
    PDF_DIR.mkdir(parents=True, exist_ok=True)
    path = local_pdf(info["slug"], kind)
    path.write_bytes(http_get(info["plans"][kind]["url"], timeout=60))
    return path


def download_changed(info, previous):
    """Download each plan whose URL changed. Returns the kinds downloaded.

    Only the URL counts: the PDFs themselves are not kept between runs on
    GitHub, so a missing local file is no reason to download again.
    """
    changed = []
    for kind, plan in info["plans"].items():
        old = previous.get("plans", {}).get(kind, {})
        if old.get("url") != plan["url"]:
            download(info, kind)
            changed.append(kind)
    return changed


def fetch_all():
    """Check every studio; returns {slug: {info, changed}} and the sources map."""
    previous = load_sources()
    result = {}
    for slug in studio_slugs():
        info = studio_info(slug)
        if not info["plans"]:
            continue
        changed = download_changed(info, previous.get(slug, {}))
        result[slug] = {"info": info, "changed": changed}
    return result


if __name__ == "__main__":
    found = fetch_all()
    for slug, entry in found.items():
        kinds = ", ".join(sorted(entry["info"]["plans"]))
        print(f"{slug:24} {kinds:8} neu geladen: {entry['changed'] or '-'}")
