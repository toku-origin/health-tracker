"""改訂第2版『身体活動のメッツ(METs)表』成人版のPDFから、全活動のMETsを取り出す。
body.js の METS_DETAIL の値が表と一致しているかの確認に使う。

使い方:
    pdftotext -layout メッツ表.pdf mets.txt
    python tools/extract_mets.py mets.txt mets.json
"""
import json
import re
import sys


def main(src, dst):
    lines = [l.strip() for l in open(src, encoding="utf-8")]
    out = {}
    for i, line in enumerate(lines):
        # 「コード METs（説明の続き）」の行
        m = re.match(r"^(\d{5})\s+(\d+(?:\.\d+)?)(?:\s+(.*))?$", line)
        if not m:
            continue
        # その上に続く日本語の説明（折り返しを含む）を集める
        ja = []
        j = i - 1
        while (j >= 0 and lines[j] and not re.match(r"^[A-Za-z(]", lines[j])
               and not re.match(r"^\d{5}", lines[j]) and "METs）表" not in lines[j]):
            ja.insert(0, lines[j])
            j -= 1
        out[m.group(1)] = {"mets": float(m.group(2)), "description": "".join(ja) + (m.group(3) or "")}
    with open(dst, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=1)
    print(f"{len(out)} 件を {dst} に書き出しました")


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
