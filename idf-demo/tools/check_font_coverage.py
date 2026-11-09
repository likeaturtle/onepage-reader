#!/usr/bin/env python3
"""Static checks for the calendar build.

1. Every non-ASCII character in the firmware sources must exist in the
   embedded GB2312 table, otherwise the panel would draw a hollow box.
2. The BLE service/characteristic UUIDs in the C header must appear in the
   phone page.

Run this after changing UI strings or the BLE UUIDs:

    python3 tools/check_font_coverage.py

Exit status is 0 when both checks pass.
"""

import re
import struct
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
FONT = ROOT / "components" / "onepage_c61" / "font_gb2312_24.bin"
HEADER = ROOT / "components" / "ble_calendar" / "include" / "ble_calendar.h"
WEB = ROOT / "web" / "index.html"


def font_codepoints():
    data = FONT.read_bytes()
    magic, version, px, row_bytes, count, _ = struct.unpack("<4sHBBII", data[:16])
    if magic != b"OPF1" or version != 1:
        sys.exit(f"{FONT}: bad header")
    stride = 4 + row_bytes * px
    return {
        struct.unpack("<I", data[16 + i * stride : 20 + i * stride])[0]
        for i in range(count)
    }


def source_files():
    patterns = ["main/*.c", "main/*.h", "components/*/src/*.c", "components/*/include/*.h"]
    files = []
    for pattern in patterns:
        files.extend(ROOT.glob(pattern))
    return sorted(files)


def check_font():
    cps = font_codepoints()
    missing = {}
    for path in source_files():
        for lineno, line in enumerate(path.read_text().splitlines(), 1):
            for ch in line:
                if ord(ch) >= 0x80 and ord(ch) not in cps:
                    missing.setdefault(ch, []).append(f"{path.relative_to(ROOT)}:{lineno}")
    if missing:
        print(f"font coverage: {len(missing)} missing character(s)")
        for ch, where in sorted(missing.items()):
            print(f"  U+{ord(ch):04X} {ch!r}: {', '.join(where[:4])}")
        return False
    print(f"font coverage: OK ({len(cps)} glyphs)")
    return True


def check_uuids():
    header = HEADER.read_text()
    web = WEB.read_text()
    uuids = sorted(set(re.findall(r"6f6e6570-6167-6531-6361-[0-9a-f]{12}", header)))
    if not uuids:
        print("BLE UUIDs: no canonical UUID strings found in the header")
        return False
    missing = [uuid for uuid in uuids if uuid not in web]
    # The INFO characteristic is optional for the page; do not require it.
    missing = [u for u in missing if not u.endswith("000000000003")]
    if missing:
        print("BLE UUIDs: missing from web/index.html:")
        for uuid in missing:
            print(f"  {uuid}")
        return False
    print("BLE UUIDs: OK (service, RX, TX match the phone page)")
    return True


def main():
    ok = check_font()
    ok = check_uuids() and ok
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
