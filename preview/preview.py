#!/usr/bin/env python3
"""Pixel-accurate preview of the bike display layout.

Rendering harness (font parsing, canvas, PNG) lives in the crowpanel-epd
library; this file holds only the project's layouts. Edit draw_layout,
run, look at preview_proposed.png, and mirror final coordinates back into
render() in bike_display.ino.
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path.home() / "Documents/Arduino/libraries/crowpanel-epd/preview"))
from epd_preview import Canvas, write_png  # noqa: E402
from bike_icon import ICON, ICON_W, ICON_H  # noqa: E402


def draw_icon(c: Canvas, x0, y0, color):
    """Mirror of GFX drawBitmap(BIKE_ICON) in firmware."""
    for y, row in enumerate(ICON):
        for x, v in enumerate(row):
            if v:
                c.set(x0 + x, y0 + y, color)


def draw_layout(c: Canvas, bikes, ebikes, docks, fetch_ok=True):
    """The layout in firmware render() — keep in sync with bike_display.ino.

    Badge 62x62 at x=8 with white bike glyph, text column at x=84
    (widest sub-line "18 e-bikes, 12 docks" is 165px -> fits 250-84)."""
    BX, BY, BW_, BH = 8, 30, 62, 62
    BASE = 77          # shared baseline for the big number
    SUB_BASE = 112     # bottom info line baseline
    LEFT = 84          # left edge of the text column

    c.fill_round_rect(BX, BY, BW_, BH, 8, 1)
    draw_icon(c, BX + (BW_ - ICON_W) // 2, BY + (BH - ICON_H) // 2, 0)

    if bikes < 0:
        c.text("FreeSansBold12pt7b", LEFT, BASE, "No data", 1)
    elif bikes == 0:
        c.text("FreeSansBold12pt7b", LEFT, BASE, "No bikes", 1)
    else:
        x = c.text("FreeSansBold24pt7b", LEFT, BASE, str(bikes), 1)
        c.text("FreeSansBold12pt7b", x + 6, BASE, "bikes", 1)

    if bikes >= 0:
        eb = "e-bike" if ebikes == 1 else "e-bikes"
        dk = "dock" if docks == 1 else "docks"
        c.text("FreeSans9pt7b", LEFT, SUB_BASE,
               f"{ebikes} {eb}, {docks} {dk}", 1)
    else:
        c.text("FreeSans9pt7b", LEFT, SUB_BASE, "<station>", 1)


if __name__ == "__main__":
    variants = []
    # (bikes_total, ebikes, docks): normal, single digit, zero, fetch fail
    for args in [(18, 12, 12), (3, 1, 20), (0, 0, 23), (-1, 0, 0)]:
        c = Canvas()
        draw_layout(c, *args)
        variants.append(c)
    out = Path(__file__).parent / "preview_proposed.png"
    write_png(out, variants)
    print(f"wrote {out}")
