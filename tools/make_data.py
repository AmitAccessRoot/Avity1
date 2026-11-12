"""
make_data.py : बड़ी डेटा फाइल को छोटी-छोटी फाइलों में बांटता है
और data/files.json अपने आप बना देता है.

इस्तेमाल:
    python make_data.py all.json
    python make_data.py all.jsonl

all.json  : [ {"q": "...", "a": "..."}, ... ]  (एक सूची)
all.jsonl : हर लाइन में एक {"q": "...", "a": "..."}   (बहुत बड़े डेटा के लिए अच्छा)

नतीजा: ../data/ फोल्डर में data1.jsonl, data2.jsonl ... और files.json
"""
import json
import os
import sys
import time

SRC = sys.argv[1] if len(sys.argv) > 1 else "all.json"
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "data")
MAX_BYTES = 20 * 1024 * 1024  # एक फाइल अधिकतम करीब 20 MB


def read_items(path):
    if path.lower().endswith(".jsonl"):
        with open(path, encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if line:
                    yield json.loads(line)
    else:
        with open(path, encoding="utf-8") as f:
            for item in json.load(f):
                yield item


def main():
    os.makedirs(OUT, exist_ok=True)
    for name in os.listdir(OUT):
        if name.startswith("data") and name.endswith(".jsonl"):
            os.remove(os.path.join(OUT, name))

    names = []
    out = None
    size = 0
    total = 0
    skipped = 0

    def new_file():
        nonlocal out, size
        if out:
            out.close()
        name = "data%d.jsonl" % (len(names) + 1)
        names.append(name)
        out = open(os.path.join(OUT, name), "w", encoding="utf-8")
        size = 0

    for item in read_items(SRC):
        if not isinstance(item, dict) or not isinstance(item.get("q"), str) or not isinstance(item.get("a"), str):
            skipped += 1
            continue
        if not item["q"].strip():
            skipped += 1
            continue
        line = json.dumps({"q": item["q"], "a": item["a"]}, ensure_ascii=False) + "\n"
        n = len(line.encode("utf-8"))
        if out is None or size + n > MAX_BYTES:
            new_file()
        out.write(line)
        size += n
        total += 1

    if out:
        out.close()

    with open(os.path.join(OUT, "files.json"), "w", encoding="utf-8") as f:
        json.dump({"version": int(time.time()), "files": names}, f, ensure_ascii=False, indent=2)

    print("विषय:", total, " छोड़े गए:", skipped, " फाइलें:", len(names))


main()
