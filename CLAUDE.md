# Bay Wheels bike availability display

E-paper desk device showing how many Lyft/Bay Wheels bikes (and e-bikes) are
available at a nearby station.

**STATUS: working, verified on hardware 2026-08-17.** Station: **<station>** (<station-code>, station_id `<station-id>`),
hardcoded in `bike_display.ino`. This unit is the older **SSD1680** panel
revision (full refresh measured ~2.4s). Forked from bus-display
(github.com/christianalmer/bus-display); hardware layer is done and verified —
don't rewrite it.

## Hardware (verified working — keep as-is)

- Elecrow CrowPanel 2.13" e-paper display with built-in ESP32 (Amazon ASIN B0H25DMJ8M)
- Panel: 122x250 B/W, SPI; USB-C powered
- Pins, same on ALL board revisions: SCK 12, MOSI 11, RST 10, DC 13, CS 14, BUSY 9, panel power 7 (must be HIGH), power LED 19. Elecrow demos bit-bang these; vendored driver does too
- Two panel revisions exist with identical wiring: older = **SSD1680** (this is what the bus-display unit was), newer = **JD79661** (UC8151-style, BUSY inverted). **If this project uses a NEW CrowPanel unit, determine the revision first**: flash and watch serial — SSD1680 full refresh takes ~2.1s; on the wrong driver the panel gives zero BUSY response ("refresh done in 0 ms")
  - Both drivers live in the shared **crowpanel-epd library** (`~/Documents/Arduino/libraries/crowpanel-epd`, repo github.com/christianalmer/crowpanel-epd): SSD1680 = `<epd1680.h>` (active include), JD79661 = `src/jd79661/` (swap in if needed). Canvas translation = `<epd_canvas.h>` `epdCanvasToPanel()`. Edit the library to change hardware behavior for ALL display projects
- Partial refresh correctness (SSD1680): RAM 0x26 must hold the on-glass frame; the library's `epd1680.cpp` rewrites it after every refresh (shadow copy in MCU RAM) and sleeps in deep-sleep mode 1. Don't switch to mode-2 sleep or cut panel power between updates. Partial uses the panel's factory OTP Mode-2 waveform (`0x22 = 0xFC`) — GxEPD2 was tried and dropped (its LUT ghosts badly on this glass)
- USB: CH340K reporting idProduct **0x7522** — macOS needs WCH's CH34xVCPDriver
  (github.com/WCHSoftGroup/ch34xser_macos), approved in System Settings → General →
  Login Items & Extensions → Driver Extensions. Port: `/dev/cu.wchusbserial*`
  (renumbers between sessions — always `ls` first)

## Build/flash (unchanged)

- FQBN: `esp32:esp32:esp32s3:PSRAM=opi,FlashSize=8M,PartitionScheme=huge_app`
- `arduino-cli compile --fqbn <fqbn> bike_display` from repo root; upload with `-p /dev/cu.wchusbserial*`
- Libraries: Adafruit GFX, ArduinoJson v7 (both installed)
- Serial monitor: pyserial with `setDTR(False); setRTS(False)`; pulse RTS True→False to reset
- Secrets in gitignored `bike_display/secrets.h` (copied from bus-display: real WiFi creds; only SSID/pass are used, the leftover 511 key define is harmless)

## Data source: Bay Wheels GBFS (verified 2026-08-17)

- Public, no API key, no auth: `https://gbfs.baywheels.com/gbfs/en/station_status.json`
  (301-redirects to gbfs.lyftbikes.com — HTTPClient must follow redirects, or use
  the lyftbikes URL directly)
- `station_information.json` (same base) maps station_id → name/lat/lon; station ids
  are UUIDs, so look up the station once and hardcode the id
- Fields per station: `num_bikes_available`, `num_ebikes_available`, `num_docks_available`
- **Response is ~240 KB (634 stations)** — too big for the bus-display approach of
  reading the body into a String. Firmware uses the ArduinoJson
  "deserialize in chunks" pattern: `useHTTP10(true)` (no chunked framing on the
  raw stream), `Stream::find()` to the `stations` array, then one small
  `deserializeJson` per station object until ours turns up. The gzip+BOM quirks
  of 511 do NOT apply here (plain JSON)
- **esp32 core 3.3.11 streaming gotcha**: `NetworkClientSecure::read(buf,len)`
  returns -1 whenever no decrypted bytes are pending (NetworkClientSecure.cpp:273)
  and `NetworkClient::readBytes` treats r<0 as fatal, so ArduinoJson reading the
  Stream directly gets a false EOF (`IncompleteInput`) at a random TLS-record
  boundary ~20-40 stations in. `find()`/`findUntil()` are unaffected (Stream's
  own `timedRead` loops). Fix: the `PatientReader` custom reader in
  bike_display.ino, which retries until data arrives / real EOF / 10s
- Station order in the feed is NOT stable between fetches (ours has shown up at
  index 222-284) — always scan, never assume position
- GBFS data updates every ~30-60s; poll once a minute is plenty. No rate limit
  drama. Whole scan to our station takes <1s
- The bike badge glyph is generated: `preview/bike_icon.py` freezes the icon to
  `bike_display/bike_icon.h` and exports the same pixels to preview.py, so both
  renderers match by construction. Re-run it after editing the drawing

## Legacy reference

The bus-display repo (github.com/christianalmer/bus-display) holds the working
Muni version of everything here, including the schedule-merge machinery and its
GitHub Actions refresh pipeline, if a "static table + live data" pattern is ever
needed again.
