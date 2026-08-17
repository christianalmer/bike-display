# Bay Wheels bike availability display

E-paper desk device showing how many Lyft/Bay Wheels bikes (and e-bikes) are
available at a nearby station.

**STATUS: fresh clone of the finished bus-display project
(github.com/christianalmer/bus-display) — the firmware still shows Muni bus
departures and needs adapting. See "Adaptation TODO" below. Hardware layer is
done and verified; don't rewrite it.**

## Hardware (verified working — keep as-is)

- Elecrow CrowPanel 2.13" e-paper display with built-in ESP32 (Amazon ASIN B0H25DMJ8M)
- Panel: 122x250 B/W, SPI; USB-C powered
- Pins, same on ALL board revisions: SCK 12, MOSI 11, RST 10, DC 13, CS 14, BUSY 9, panel power 7 (must be HIGH), power LED 19. Elecrow demos bit-bang these; vendored driver does too
- Two panel revisions exist with identical wiring: older = **SSD1680** (this is what the bus-display unit was), newer = **JD79661** (UC8151-style, BUSY inverted). **If this project uses a NEW CrowPanel unit, determine the revision first**: flash and watch serial — SSD1680 full refresh takes ~2.1s; on the wrong driver the panel gives zero BUSY response ("refresh done in 0 ms")
  - SSD1680 driver: `bike_display/epd1680.{h,cpp}` (active)
  - JD79661 driver: `bike_display/extras/jd79661/` (swap in if needed; draws via GFXcanvas1 the same way)
- Partial refresh correctness (SSD1680): RAM 0x26 must hold the on-glass frame; `epd1680.cpp` rewrites it after every refresh (shadow copy in MCU RAM) and sleeps in deep-sleep mode 1. Don't switch to mode-2 sleep or cut panel power between updates. Partial uses the panel's factory OTP Mode-2 waveform (`0x22 = 0xFC`) — GxEPD2 was tried and dropped (its LUT ghosts badly on this glass)
- USB: CH340K reporting idProduct **0x7522** — macOS needs WCH's CH34xVCPDriver
  (github.com/WCHSoftGroup/ch34xser_macos), approved in System Settings → General →
  Login Items & Extensions → Driver Extensions. Port: `/dev/cu.wchusbserial*`
  (renumbers between sessions — always `ls` first)

## Build/flash (unchanged)

- FQBN: `esp32:esp32:esp32s3:PSRAM=opi,FlashSize=8M,PartitionScheme=huge_app`
- `arduino-cli compile --fqbn <fqbn> bike_display` from repo root; upload with `-p /dev/cu.wchusbserial*`
- Libraries: Adafruit GFX, ArduinoJson v7 (both installed)
- Serial monitor: pyserial with `setDTR(False); setRTS(False)`; pulse RTS True→False to reset
- Secrets in gitignored `bike_display/secrets.h` (copied from bus-display: real WiFi creds; the 511 key is vestigial here)

## Data source: Bay Wheels GBFS (verified 2026-08-17)

- Public, no API key, no auth: `https://gbfs.baywheels.com/gbfs/en/station_status.json`
  (301-redirects to gbfs.lyftbikes.com — HTTPClient must follow redirects, or use
  the lyftbikes URL directly)
- `station_information.json` (same base) maps station_id → name/lat/lon; station ids
  are UUIDs, so look up the station once and hardcode the id
- Fields per station: `num_bikes_available`, `num_ebikes_available`, `num_docks_available`
- **Response is ~240 KB (634 stations)** — too big for the bus-display approach of
  reading the body into a String. Use ArduinoJson's streaming deserialize from the
  HTTP Stream with a filter, or scan for the station_id substring. The gzip+BOM
  quirks of 511 do NOT apply here (plain JSON)
- GBFS data updates every ~30-60s; poll once a minute is plenty. No rate limit drama

## Adaptation TODO (roughly in order)

1. Ask the user which station (or find nearest via station_information + their
   address) and hardcode its station_id
2. Replace `fetchPredictions()`/gunzip/schedule-merge machinery in
   `bike_display/bike_display.ino` with a GBFS fetch (streaming parse — see above).
   Delete: `schedule.h`, the RtSched/NVS code, `SCHEDULE_URL`, `parseIso8601Utc`
   (no timestamps needed), the 511 config. Keep: WiFi/NTP (NTP only if showing a
   clock; otherwise droppable), render pipeline, refresh cadence logic
3. New layout in `preview/preview.py` first (pixel-accurate, no flashing needed;
   keep `draw_layout_v2` in sync with firmware `render()`). Old composition:
   badge left / big number / sub-line — likely reusable with a bike glyph instead
   of the "23" badge and "bikes / e-bikes" split
4. Refresh behavior: bike counts change more often than bus minutes but matter
   less per-unit; partial refresh on count change, full every 5 partials (same as
   bus display) should work unchanged
5. No CI pipeline needed (no schedule to bake) — `.github/` and `tools/` were
   already stripped from the copy

## Legacy reference

The bus-display repo (github.com/christianalmer/bus-display) holds the working
Muni version of everything here, including the schedule-merge machinery and its
GitHub Actions refresh pipeline, if a "static table + live data" pattern is ever
needed again.
