#!/usr/bin/env python3
"""
Build data.js from Doug Bookman's two Word documents.

  1. "Re-done Harmony - May 2010.doc"                  (A Proposed Harmony of the Life of Christ)
  2. "Harmonized Bible Reading Assignments.doc"         (9 reading assignment sheets)

Convert each .doc to HTML first (macOS):
  textutil -convert html -output harmony.html  "Re-done Harmony - May 2010.doc"
  textutil -convert html -output readings.html "Harmonized Bible Reading Assignments.doc"

Then:
  python3 tools/build_data.py harmony.html readings.html > data.js

Obvious reference typos in the source documents are corrected in FIXES below.
"""
import json
import re
import sys
from html.parser import HTMLParser


# ---------------------------------------------------------------- HTML stream
class Stream(HTMLParser):
    """Emit an ordered list of ('p', text) for paragraphs outside tables and
    ('row', [cell, ...]) for table rows. Cell text keeps paragraph breaks as \n."""

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.events, self.row, self.cell, self.para = [], None, None, None
        self.in_style = False

    def handle_starttag(self, tag, attrs):
        if tag == "style":
            self.in_style = True
        elif tag == "tr":
            self.row = []
        elif tag == "td":
            self.cell = []
        elif tag == "p":
            if self.cell is not None:
                self.cell.append("\n")
            else:
                self.para = []
        elif tag == "br":
            (self.cell if self.cell is not None else self.para or []).append("\n")

    def handle_endtag(self, tag):
        if tag == "style":
            self.in_style = False
        elif tag == "td" and self.row is not None:
            self.row.append(clean("".join(self.cell)))
            self.cell = None
        elif tag == "tr":
            self.events.append(("row", self.row))
            self.row = None
        elif tag == "p" and self.cell is None and self.para is not None:
            t = clean("".join(self.para))
            if t:
                self.events.append(("p", t))
            self.para = None

    def handle_data(self, d):
        if self.in_style:
            return
        if self.cell is not None:
            self.cell.append(d)
        elif self.para is not None:
            self.para.append(d)


def clean(s):
    s = s.replace(" ", " ").replace("\t", " ")
    lines = [re.sub(r" {2,}", " ", l).strip() for l in s.split("\n")]
    out, blank = [], False
    for l in lines:
        if l:
            out.append(l)
    return "\n".join(out).strip()


def stream(path):
    p = Stream()
    p.feed(open(path, encoding="utf-8").read())
    return p.events


# ---------------------------------------------------------------- references
BOOKS = {
    "mt": "Mt", "matt": "Mt", "matthew": "Mt",
    "mk": "Mk", "mark": "Mk",
    "lk": "Lk", "luke": "Lk",
    "jn": "Jn", "john": "Jn",
    "acts": "Ac", "ac": "Ac",
    "isa": "Isa", "mal": "Mal", "heb": "Heb",
    "1 cor": "1Co", "1cor": "1Co",
}


def norm_dash(s):
    return re.sub(r"\s*[–—-]\s*", "-", s)


def parse_segments(spec):
    """'14:13b-21, 23' -> [[14,13,14,21],[14,23,14,23]]; '24-25' -> chapters; '14' -> chapter.
    Chapter-only segments use verse None (= whole chapter)."""
    spec = norm_dash(spec)
    spec = re.sub(r"\s*(,|&|and)\s*", ",", spec)
    spec = re.sub(r"(\d)[ab]\b", r"\1", spec)  # 13b -> 13
    segs, chap = [], None
    for part in [p.strip() for p in spec.split(",") if p.strip()]:
        m = re.fullmatch(r"(\d+):(\d+)(?:-(?:(\d+):)?(\d+))?", part)
        if m:
            c1, v1, c2, v2 = m.groups()
            c1, v1 = int(c1), int(v1)
            if v2 is None:
                c2, v2 = c1, v1
            else:
                c2 = int(c2) if c2 else c1
                v2 = int(v2)
            segs.append([c1, v1, c2, v2])
            chap = c2
            continue
        m = re.fullmatch(r"(\d+)(?:-(\d+))?", part)
        if m and chap is not None and ":" not in spec.split(part)[0][-1:]:
            # bare verse(s) continuing previous chapter: "6:27-30, 32-36"
            pass
        if m:
            a, b = int(m.group(1)), int(m.group(2) or m.group(1))
            if chap is not None:
                segs.append([chap, a, chap, b])
            else:  # chapter(s) only
                segs.append([a, None, b, None])
            continue
        raise ValueError("cannot parse segment %r in %r" % (part, spec))
    return segs


def parse_ref(text, default_book=None):
    """'Luke 1:1-4' / 'Mt. 17:14-21' / '1:5-25' (with default_book) -> {b, s, t}"""
    t = text.strip().strip("[]").strip()
    t = re.sub(r"^(\d)\s+", r"\1 ", t)
    m = re.match(r"^((?:1\s*)?[A-Za-z]+)\.?\s*(.*)$", t)
    book = default_book
    rest = t
    if m and m.group(1).lower().replace(" ", "") in {k.replace(" ", "") for k in BOOKS}:
        key = m.group(1).lower()
        key = "1 cor" if key.replace(" ", "") == "1cor" else key
        book = BOOKS[key]
        rest = m.group(2)
    rest = re.sub(r"\s*:\s*", ":", rest)
    rest = re.sub(r"(\d)-\s+(\d)", r"\1-\2", rest)
    return {"b": book, "s": parse_segments(rest)}


# ---------------------------------------------------------------- the harmony
HARMONY_FIXES = {
    (5, "lk"): "3:23-38",  # source reads 3:23-28; Luke's genealogy runs to 3:38
}

GOSPEL_KEYS = ["mt", "mk", "lk", "jn"]
GOSPEL_BOOK = {"mt": "Mt", "mk": "Mk", "lk": "Lk", "jn": "Jn"}

UNIT_TITLES = {
    "UNIT ONE": ("I came forth from the Father…", "John 16:28a"),
    "UNIT TWO": ("…and am come into the world…", "John 16:28b"),
    "UNIT THREE": ("…again, I leave the world…", "John 16:28c"),
    "UNIT FOUR": ("…and go to the Father", "John 16:28d"),
}


def split_quote(text):
    """'“He came unto His own…” (John 1:11a)' -> ('He came unto His own…', 'John 1:11a')"""
    m = re.match(r"^[“\"](.*)[”\"]\s*\(([^)]*)\)\s*$", text.strip())
    if m:
        return m.group(1).strip(), m.group(2).strip()
    return None


def strip_label(title):
    m = re.match(r"^(\d+[abc])\.?\s*(.*)$", title.strip(), re.S)
    if m:
        return m.group(1), m.group(2).strip()
    return None, title.strip()


def build_harmony(path):
    ev = stream(path)
    units, part, unit = [], None, None
    pending_quote = None
    pending_note = False
    day = None

    def new_part(quote, ref):
        nonlocal part
        part = {"quote": quote, "ref": ref, "subtitle": "", "note": [], "items": []}
        unit["parts"].append(part)

    for kind, val in ev:
        if kind == "p":
            t = val
            if t.startswith("A PROPOSED HARMONY") or t.startswith("Page") or "NUMPAGES" in t:
                continue
            um = re.match(r"^(UNIT (ONE|TWO|THREE|FOUR)):?\s*(.*)$", t)
            if um:
                q, r = UNIT_TITLES[um.group(1)]
                unit = {"title": um.group(1).title(), "quote": q, "ref": r, "parts": []}
                units.append(unit)
                continue
            if unit and split_quote(t) and split_quote(t)[1] == unit["ref"]:
                continue  # the unit's own John 16:28 line
            sq = split_quote(t)
            if sq:
                new_part(*sq)
                continue
            if t.startswith("(") and t.endswith(")") and part and not part["subtitle"]:
                part["subtitle"] = t[1:-1].strip()
                continue
            if t.startswith("NOTE"):
                pending_note = True
                rest = t[4:].lstrip(": ").strip()
                if rest:
                    part["note"].append(rest)
                continue
            if pending_note and part is not None:
                # continuation paragraphs of a part-level NOTE
                if part["note"] and re.search(r"=\s*$", part["note"][-1]):
                    part["note"][-1] += " " + t
                else:
                    part["note"].append(t)
                continue
            continue

        # ---- table rows
        cells = val
        if not cells or not any(cells):
            continue
        pending_note = False
        if len(cells) >= 6 and cells[2] == "Matthew":
            continue  # header row
        if len(cells) == 1:
            t = cells[0]
            if t.startswith("NOTE"):
                part["items"].append({"t": "note", "text": t.split(":", 1)[1].strip()})
            elif t.isupper():
                part["items"].append({"t": "day", "text": t.title()})
            continue
        num, title = cells[0], cells[1]
        cols = (cells[2:6] + ["", "", "", ""])[:4] if len(cells) >= 6 else ["", "", "", ""]
        if len(cells) == 2:
            if num.startswith("NOTE"):
                part["items"].append({"t": "note", "text": num.split(":", 1)[1].strip()})
            elif title:
                txt = re.sub(r"^NOTE:\s*", "", title.strip("()").strip())
                part["items"].append({"t": "note", "text": txt, "aside": True})
            continue
        if not num and title.startswith("NOTE"):
            part["items"].append({"t": "note", "text": title.split(":", 1)[1].strip()})
            continue
        if num and not num.startswith("#") and num.isupper():
            # day banner like "FRIDAY, SATURDAY" or "SUNDAY, A DAY OF ..."
            part["items"].append({"t": "day", "text": num})
            continue
        # embedded NOTE inside title cell
        inner_note = None
        if "\nNOTE:" in title:
            title, inner_note = title.split("\nNOTE:", 1)
            inner_note = inner_note.strip()
        label, text = strip_label(title.replace("\n", " "))
        level = label[-1] if label else None
        if not num:
            part["items"].append({"t": "group", "label": label, "level": level, "text": text})
            if inner_note:
                part["items"].append({"t": "note", "text": inner_note})
            continue
        n = int(num.lstrip("#"))
        sec = {"t": "sec", "n": n, "label": label, "level": level, "title": text, "refs": []}
        if text.startswith("(") and text.endswith(")"):
            sec["title"] = text[1:-1]
            sec["meanwhile"] = True
        if inner_note:
            sec["note"] = inner_note
        for key, cell in zip(GOSPEL_KEYS, cols):
            cell = HARMONY_FIXES.get((n, key), cell).replace("\n", " ").strip()
            if not cell:
                continue
            cf = None
            m = re.search(r"\(cf\.\s*([^)]*)\)", cell)
            if m:
                cf = m.group(1)
                cell = cell[: m.start()].strip()
            m = re.fullmatch(r"\((.*)\)", cell)
            if m:  # e.g. "(1 Cor 15:7)" in Matthew column: not narrated in the Gospels
                sec["refs"].append(parse_ref(m.group(1)))
                continue
            sec["refs"].append(parse_ref(cell, GOSPEL_BOOK[key]))
            if cf:
                sec["refs"].append(dict(parse_ref(cf), cf=1))
        part["items"].append(sec)
    return units


# ---------------------------------------------------------------- reading sheets
SHEET_FIXES = {
    # (sheet, source text) -> corrected reference
    (1, "Mt 3:1-12"): "Jn 1:1-18",          # under "Prologue to John's Gospel"
    (1, "Lk 3:23-28"): "Lk 3:23-38",
    (1, "[Lk 4:14-31]"): "Lk 4:16-31",
    (3, "John 1:13-22"): "John 2:13-22",
    (3, "Lk 1:14"): "Mk 1:14",
    (4, "Lk 1:35-39"): "Mk 1:35-39",
    (5, "Mk 8:9, 10"): "Mk 9:9-10",
    (5, "Mt 9:30-32"): "Mk 9:30-32",
    (5, "Mk 9:11-14"): "Mk 9:11-13",
    (7, "Mt 19:1 – 20:43"): "Mt 19:1 – 20:34",
    (8, "Mk 11:20-26#1"): "Mk 11:12-14",     # Monday's cursing; 11:20-26 is Tuesday
    (8, "Mk 13:1-47"): "Mk 13:1-37",
    (8, "Lk 19:5-38"): "Lk 21:5-38",
    (9, "Jn 13:1-14-31"): "Jn 13:1 – 14:31",
    (9, "Lk 23:50-54#1"): "Lk 23:47-49",     # physical phenomena (burial is 23:50-54)
    (9, "Mk 126:9-14"): "Mk 16:9-14",
}
OPTIONAL = {(1, "[Lk 4:14-31]"), (8, "Mt 24:1-25:46"), (8, "Mk 13:1-47"), (8, "Lk 19:5-38")}

# Footnotes printed at the end of the document, attached to their passages.
FOOTNOTES = {
    (8, "Mt 21:20-22"): "There were two stages to this event – on Monday the tree was cursed, on Tuesday it was found withered.  Mark makes this clear.  Matthew (as was his wont) grouped them together (he tends to arrange events more thematically than chronologically).  Mt 21:18 refers to Monday morning (i.e., the morning of the day which he had narrated in 21:12-17); 21:20 refers to Tuesday morning (when the fig tree was discovered to have withered, and Jesus responded to the wonder of His disciples).",
    (8, "Jn 12: 20-36"): "Only John records the remarkable and poignant interview of Jesus with some Greek proselytes who had come to Jerusalem for the Passover, and of His consequent contemplation of His own soon-coming death.  It is difficult to know precisely when this event occurred, but the best guess is that it was sometime on Tuesday, during the season of teaching and confrontation in the Temple precincts.  Contemplate this narrative carefully; it is very important in anticipation of the scene in the Garden of Gethsemane.",
    (8, "Jn 12:37-50"): "It is virtually impossible to determine when the words of Jesus recorded here were spoken, and it is virtually certain that they were not spoken on Wednesday of the Passion Week. However, they are placed at this point by the Apostle John because he regards them as an appropriate way to summarize the first section of his Gospel (“He came unto His own and His own received Him not..”) and to introduce the last part of the Gospel account (“..having loved His own who were in the world, He loved them unto the end.”).  Read those verses in that way – as a Spirit-breathed transition from the period of Jesus’ offer of Himself to the nation to the record of His offer of Himself as the lamb of God.",
    (9, "Lk 22:14-38"): "Notice that Luke’s narrative includes Jesus’ prediction of Peter’s denial in the upper room.  Compare this to the next section in Mark.",
    (9, "1 Cor 11:23-26"): "Paul states that Jesus took the bread & cup “while He was being betrayed” (παρεδιδετο – imperfect passive vb.) gave them to His disciples.  That is, as Judas was scurrying off to fetch the arresting force, Jesus remained for a time in the upper room and introduced the “Lord’s supper.”",
    (9, "Mk 14:27-31"): "Mark is clear that it was after Jesus and the 11 departed the upper room (Mk 14:26, cf :27) that He warned His disciples about desertion, and, in response to Peter’s protestations concerning his special loyalty, the Lord warned Peter (again) of his three-fold denial.  Because Luke has a similar incident in the upper room (i.e., before the departure, Lk 22:31-34), some have insisted there is a discrepancy in the record.  However, it makes perfect sense – given what we know of the man, Peter – that Jesus spoke this warning first of all in the upper room, and then again – in response to Peter’s renewed insistence upon his own dependability – on the road to Gethsemane just a little later.",
    (9, "Jn 18:13-14, 19-24"): "The Synoptics state that after Jesus was arrested He was taken to Caiaphas (high priest at that time); John states that He was taken “first” to Annas.  Annas was Caiaphas’ father-in-law; he had been high priest for some time, had been deposed for cruelty and rapaciousness, but continued to live in the priestly villa.",
}

REF_START = re.compile(r"^\[?(?:(?:1\s*)?(?:Mt|Mk|Lk|Jn|John|Luke|Mark|Matt|Matthew|Acts|Isa|Mal|Heb|Cor)\b|1 Cor)")
BOILERPLATE = ("Read each of the passages", "Please read the sections", "Please take careful notice",
               "Assignment", ":", "(Check box", "Record below", "In the space below", "NAME",
               "©Doug Bookman", "PRISON EPISTLES", "PAGE")


def split_questions(text):
    """Split a questions cell into (prose, [questions])."""
    if not text:
        return "", []
    prose, qs = [], []
    for line in text.split("\n"):
        m = re.match(r"^(\d+)\)\s*(.*)$", line)
        if m:
            qs.append({"n": int(m.group(1)), "q": m.group(2).strip()})
        elif qs and not re.match(r"^[a-z]\.\s", line):
            qs[-1]["q"] += " " + line
        else:
            prose.append(line)
    return "\n".join(prose), qs


def heading_level(line, last):
    """I./II. -> 1, A./B. -> 2, 1./2. -> 3, a./b. -> 4; unlabeled -> 3 (Meanwhile…) or 2."""
    m = re.match(r"^([IVX]+|[A-Z]|\d+|[a-z])\.\s?", line)
    if not m:
        return 3 if re.match(r"^(\*\*|Meanwhile|Then,)", line) else 2
    tok = m.group(1)
    if tok.isdigit():
        lv = 3
    elif tok.islower():
        lv = 4
    elif len(tok) > 1 or (tok == "V" and last.get(1) == "IV") or (tok == "I" and last.get(2) != "H"):
        lv = 1
    else:
        lv = 2
    last[lv] = tok
    if lv == 1:
        last.pop(2, None)
    return lv


def build_sheets(path):
    ev = stream(path)
    sheets, sheet, group = [], None, None
    seen = {}
    genealogy, in_essay = [], False
    hdr_state = 0

    def new_group(heading, level):
        nonlocal group
        group = {"h": heading, "lv": level, "note": "", "q": [], "r": []}
        sheet["items"].append(group)
        return group

    for kind, val in ev:
        if kind == "p":
            t = val
            m = re.match(r"^Harmonized Bible Reading Assignment Sheet #(\d)", t)
            if m:
                in_essay = False
                sheet = {"n": int(m.group(1)), "title": "", "intro": [], "items": []}
                last = {}
                sheets.append(sheet)
                hdr_state = 1
                group = None
                continue
            if sheet is None:
                continue
            if t == "The Genealogies of Jesus" and sheet["n"] == 1:
                in_essay = True
                continue
            if in_essay:
                genealogy.append(t)
                continue
            if any(t.startswith(b) for b in BOILERPLATE) or t in ("T", "HE"):
                hdr_state = 2 if hdr_state else 0
                continue
            if any(t[:40] == fn[:40] for fn in FOOTNOTES.values()):
                continue  # end-of-document footnotes, attached to passages below
            if hdr_state == 1 and not t.startswith("NOTE") and len(t) < 130:
                sheet["title"] = (sheet["title"] + " " + t).strip()
                continue
            hdr_state = 2
            # intro notes
            t = re.sub(r"^NOTE:\s*|^Note:\s*", "", t)
            if len(t) > 40:
                sheet["intro"].append(t)
            continue

        cells = [c for c in val]
        if sheet is None or not any(cells):
            continue
        hdr_state = 0
        if cells[0].startswith("Passage to be read"):
            continue
        first = cells[0]
        rest = [c for c in cells[1:]]
        # heading / note rows
        if not REF_START.match(first) and not (first == "" and len(cells) >= 2 and REF_START.match(cells[1] or "x")):
            text = first or (rest[0] if rest else "")
            if not text or text.startswith("(Check box"):
                continue
            # A single cell may hold a Focus line + a sub-heading ("Focus: ...\nA. ..."),
            # or one heading wrapped over two lines; join continuation lines.
            lines = []
            for line in text.split("\n"):
                line = line.strip()
                starts = re.match(r"^(Focus:|NOTE|Note:|\*\*|([IVX]+|[A-Z]|\d+|[a-z])\.\s?)", line)
                if lines and line and not starts:
                    lines[-1] += " " + line
                else:
                    lines.append(line)
            for line in lines:
                line = line.strip()
                if not line or line.startswith("(Check box"):
                    continue
                if re.match(r"^(NOTE|Note):", line):
                    note = re.sub(r"^(NOTE|Note):\s*", "", line)
                    sheet["items"].append({"t": "note", "text": note})
                    group = None
                    continue
                if line.startswith("Focus:"):
                    sheet["items"].append({"t": "focus", "text": line[6:].strip()})
                    group = None
                    continue
                lv = heading_level(line, last)
                line = line.lstrip("*").strip()
                new_group(line, lv)
            continue
        # reading rows
        src = first.replace("\n", " ")
        src = re.sub(r"\s+", " ", src).strip()
        key = (sheet["n"], src)
        seen[key] = seen.get(key, 0) + 1
        fix_key = (sheet["n"], "%s#%d" % (src, seen[key]))
        corrected = SHEET_FIXES.get(fix_key) or SHEET_FIXES.get(key) or src
        note_cell = rest[1] if len(rest) > 1 else ""
        q_cell = rest[2] if len(rest) > 2 else ""
        prose, qs = split_questions(q_cell)
        if note_cell and prose:
            note_cell = note_cell + "\n" + prose
        elif prose:
            note_cell = prose
        if group is None or group["lv"] == 1 and group["r"]:
            group = new_group("", 3) if group is None else group
        r = {"src": src, "ref": parse_ref(corrected)}
        if corrected != src:
            r["fixed"] = True
        if key in OPTIONAL:
            r["opt"] = True
        if note_cell:
            r["note"] = note_cell
        if qs:
            r["q"] = qs
        if key in FOOTNOTES:
            r["fn"] = FOOTNOTES[key]
        group["r"].append(r)

    # hoist: if only the first reading in a group has note/questions, it belongs to the group
    for s in sheets:
        for g in s["items"]:
            if g.get("r") is None:
                continue
            annotated = [r for r in g["r"] if r.get("note") or r.get("q")]
            if len(annotated) == 1 and annotated[0] is g["r"][0]:
                r0 = g["r"][0]
                g["note"] = r0.pop("note", "")
                g["q"] = r0.pop("q", [])
        # drop empty headings that were only containers with no readings and no text
    # Sheet 4 numbers two consecutive divisions "IV."; the second is V.
    for g in sheets[3]["items"]:
        if g.get("h", "").startswith("IV. The “busy day”"):
            g["h"] = "V." + g["h"][3:]
    if sheets:
        sheets[0]["essay"] = {"title": "The Genealogies of Jesus", "paras": genealogy}
    return sheets


def main():
    harmony = build_harmony(sys.argv[1])
    sheets = build_sheets(sys.argv[2])
    out = {"units": harmony, "sheets": sheets}
    print("// Generated by tools/build_data.py from Doug Bookman's materials. Do not edit by hand.")
    print("window.HARMONY_DATA = " + json.dumps(out, ensure_ascii=False, separators=(",", ":")) + ";")


if __name__ == "__main__":
    main()
