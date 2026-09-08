// Bay Wheels availability logger + trends site for <station> Ave.
// Cron (1/min) samples the public GBFS feed into D1; fetch() serves the
// trends page and a small JSON API (CORS open — the iOS widget will use it).

// @ts-expect-error - wrangler Text rule imports .html as a string
import PAGE_HTML from "./page.html";

export interface Env {
  DB: D1Database;
}

const STATION_ID = "<station-id>"; // <station-code>
const STATION_NAME = "<station> Ave";
// gbfs.baywheels.com 301s here; go direct.
const STATUS_URL = "https://gbfs.lyftbikes.com/gbfs/en/station_status.json";
const TZ = "America/Los_Angeles";

// The feed is ~240 KB for 634 stations. Slice out just our station's object
// instead of JSON.parsing the whole body, to stay well inside the CPU budget.
function extractStation(text: string, id: string): Record<string, unknown> | null {
  const k = text.indexOf(id);
  if (k < 0) return null;
  // Walk back to the opening brace of the enclosing object (depth-aware, so
  // sibling objects that close before our key don't fool us).
  let depth = 0;
  let start = -1;
  for (let i = k; i >= 0; i--) {
    const c = text[i];
    if (c === "}") depth++;
    else if (c === "{") {
      if (depth === 0) { start = i; break; }
      depth--;
    }
  }
  if (start < 0) return null;
  depth = 0;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) {
        try { return JSON.parse(text.slice(start, i + 1)); } catch { return null; }
      }
    }
  }
  return null;
}

const DOW: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

function sfLocalParts(tsMs: number): { dow: number; minute: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: TZ, weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(new Date(tsMs));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const hour = parseInt(get("hour"), 10) % 24; // hour12:false can yield "24"
  return { dow: DOW[get("weekday")] ?? 0, minute: hour * 60 + parseInt(get("minute"), 10) };
}

async function samplePoll(env: Env): Promise<void> {
  const res = await fetch(STATUS_URL);
  if (!res.ok) throw new Error(`GBFS fetch failed: ${res.status}`);
  const text = await res.text();
  let st = extractStation(text, STATION_ID);
  if (!st) {
    // Fallback: full parse (paid-plan CPU handles it; free plan usually does too)
    const data = JSON.parse(text) as { data?: { stations?: Record<string, unknown>[] } };
    st = data.data?.stations?.find((s) => s.station_id === STATION_ID) ?? null;
  }
  if (!st) throw new Error("station not found in feed");

  const now = Date.now();
  const { dow, minute } = sfLocalParts(now);
  await env.DB.prepare(
    `INSERT OR REPLACE INTO samples (ts, last_reported, dow, minute, bikes_total, ebikes, docks)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      Math.floor(now / 1000),
      (st.last_reported as number) ?? null,
      dow,
      minute,
      (st.num_bikes_available as number) ?? 0,
      (st.num_ebikes_available as number) ?? 0,
      (st.num_docks_available as number) ?? 0
    )
    .run();
}

const JSON_HEADERS = {
  "content-type": "application/json",
  "access-control-allow-origin": "*",
  "cache-control": "public, max-age=30",
};

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: JSON_HEADERS });
}

export default {
  async scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(samplePoll(env));
  },

  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);

    if (url.pathname === "/api/now") {
      const row = await env.DB.prepare(
        "SELECT ts, bikes_total, ebikes, docks FROM samples ORDER BY ts DESC LIMIT 1"
      ).first();
      return json({ station: STATION_NAME, ...(row ?? { ts: null }) });
    }

    if (url.pathname === "/api/recent") {
      const hours = Math.min(Math.max(Number(url.searchParams.get("hours")) || 48, 1), 24 * 14);
      const since = Math.floor(Date.now() / 1000) - hours * 3600;
      const { results } = await env.DB.prepare(
        "SELECT ts, bikes_total, ebikes FROM samples WHERE ts >= ? ORDER BY ts"
      )
        .bind(since)
        .all();
      // Compact arrays: [ts, ebikes, classic]
      return json({
        station: STATION_NAME,
        samples: (results as { ts: number; bikes_total: number; ebikes: number }[]).map(
          (r) => [r.ts, r.ebikes, r.bikes_total - r.ebikes]
        ),
      });
    }

    if (url.pathname === "/api/heatmap") {
      const weeks = Math.min(Math.max(Number(url.searchParams.get("weeks")) || 8, 1), 52);
      const since = Math.floor(Date.now() / 1000) - weeks * 7 * 86400;
      const { results } = await env.DB.prepare(
        `SELECT dow, minute / 30 AS bucket,
                AVG(ebikes) AS ebikes,
                AVG(bikes_total - ebikes) AS classic,
                COUNT(*) AS n
         FROM samples WHERE ts >= ?
         GROUP BY dow, bucket ORDER BY dow, bucket`
      )
        .bind(since)
        .all();
      return json({ station: STATION_NAME, weeks, bucketMinutes: 30, cells: results });
    }

    if (url.pathname === "/") {
      return new Response(PAGE_HTML, {
        headers: { "content-type": "text/html; charset=utf-8", "cache-control": "public, max-age=300" },
      });
    }

    return json({ error: "not found" }, 404);
  },
};
