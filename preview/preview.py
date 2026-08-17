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


def draw_layout(c: Canvas, ebikes, classic, fetch_ok=True):
    """The layout in firmware render() — keep in sync with bike_display.ino.

    Badge 62x62 at x=8 with white bike glyph, text column at x=84.
    Big number = e-bikes, sub-line = classic bikes. ebikes < 0 = no data."""
    BX, BY, BW_, BH = 8, 30, 62, 62
    BASE = 77          # shared baseline for the big number
    SUB_BASE = 112     # bottom info line baseline
    LEFT = 84          # left edge of the text column

    c.fill_round_rect(BX, BY, BW_, BH, 8, 1)
    draw_icon(c, BX + (BW_ - ICON_W) // 2, BY + (BH - ICON_H) // 2, 0)

    if ebikes < 0:
        c.text("FreeSansBold12pt7b", LEFT, BASE, "No data", 1)
    elif ebikes == 0:
        c.text("FreeSansBold12pt7b", LEFT, BASE, "No e-bikes", 1)
    else:
        x = c.text("FreeSansBold24pt7b", LEFT, BASE, str(ebikes), 1)
        c.text("FreeSansBold12pt7b", x + 6, BASE,
               "e-bike" if ebikes == 1 else "e-bikes", 1)

    if ebikes >= 0:
        bk = "bike" if classic == 1 else "bikes"
        c.text("FreeSans9pt7b", LEFT, SUB_BASE, f"{classic} {bk}", 1)
    else:
        c.text("FreeSans9pt7b", LEFT, SUB_BASE, "<station>", 1)


if __name__ == "__main__":
    variants = []
    # (ebikes, classic_bikes): normal, single, zero e-bikes, fetch fail
    for args in [(12, 6), (1, 1), (0, 4), (-1, 0)]:
        c = Canvas()
        draw_layout(c, *args)
        variants.append(c)
    out = Path(__file__).parent / "preview_proposed.png"
    write_png(out, variants)
    print(f"wrote {out}")
