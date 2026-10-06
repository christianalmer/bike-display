# Bay Wheels bike availability display

E-paper desk device showing available Lyft/Bay Wheels bikes (and e-bikes) at a
nearby station. Sibling project of
[bus-display](https://github.com/christianalmer/bus-display), sharing its
hardware layer: an Elecrow CrowPanel 2.13" e-paper (ESP32-S3) with a vendored
SSD1680 driver, clean partial refresh, and a pixel-accurate layout preview tool.

**Status: working.** Polls the public
[Bay Wheels GBFS feed](https://gbfs.baywheels.com/gbfs/en/station_status.json)
(no API key needed) once a minute for a configurable station (see
`secrets.h.example`) and
shows the e-bike count big, with the classic-bike count below. Partial
refresh on count changes, full refresh every 5 partials. See `CLAUDE.md` for
the accumulated hardware knowledge.

## Building

1. Copy `bike_display/secrets.h.example` to `bike_display/secrets.h`, fill in WiFi credentials
2. Install libraries: Adafruit GFX, ArduinoJson (v7); esp32 core ≥ 3.x
3. ```
   arduino-cli compile --fqbn "esp32:esp32:esp32s3:PSRAM=opi,FlashSize=8M,PartitionScheme=huge_app" bike_display
   arduino-cli upload -p /dev/cu.wchusbserial* --fqbn "esp32:esp32:esp32s3:PSRAM=opi,FlashSize=8M,PartitionScheme=huge_app" bike_display
   ```
   (macOS needs [WCH's CH34x driver](https://github.com/WCHSoftGroup/ch34xser_macos))
