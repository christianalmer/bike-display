// Bay Wheels availability logger + trends site for <station> Ave.
// Cron (1/min) samples the public GBFS feed into D1; fetch() serves the
// trends page and a small JSON API (CORS open — the iOS widget will use it).

// @ts-expect-error - wrangler Text rule imports .html as a string
import PAGE_HTML from "./page.html";

export interface Env {
  DB: D1Database;
  SCHEDULER: DurableObjectNamespace;
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

async function setMeta(env: Env, k: string, v: string): Promise<void> {
  await env.DB.prepare("INSERT OR REPLACE INTO meta (k, v) VALUES (?, ?)").bind(k, v).run();
}

// The sampling clock. Cloudflare cron triggers stall for hours on this account,
// so a self-re-arming Durable Object alarm drives the 1-min sampling instead.
// Any request to the DO's fetch() arms the alarm if it isn't already set.
const SAMPLE_MS = 60_000;

export class Scheduler {
  state: DurableObjectState;
  env: Env;

  constructor(state: DurableObjectState, env: Env) {
    this.state = state;
    this.env = env;
  }

  async fetch(): Promise<Response> {
    const current = await this.state.storage.getAlarm();
    if (current === null) await this.state.storage.setAlarm(Date.now() + 2000);
    return new Response(JSON.stringify({ alarmWasArmed: current !== null, alarm: current }), {
      headers: { "content-type": "application/json" },
    });
  }

  async alarm(): Promise<void> {
    // Re-arm before sampling so one bad poll can never kill the clock.
    await this.state.storage.setAlarm(Date.now() + SAMPLE_MS);
    const now = String(Math.floor(Date.now() / 1000));
    try {
      await samplePoll(this.env);
      await setMeta(this.env, "last_alarm_ok", now);
    } catch (e) {
      await setMeta(this.env, "last_alarm_err", new Date().toISOString() + " " + String(e));
    }
  }
}

function ensureScheduler(env: Env): Promise<Response> {
  return env.SCHEDULER.get(env.SCHEDULER.idFromName("main")).fetch("https://scheduler/ensure");
}

export default {
  // Cron is only a backstop now: if it happens to fire, it re-arms the alarm.
  async scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(ensureScheduler(env));
  },

  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(req.url);
    ctx.waitUntil(ensureScheduler(env));

    if (url.pathname === "/api/health") {
      const { results } = await env.DB.prepare("SELECT k, v FROM meta").all();
      const row = await env.DB.prepare("SELECT COUNT(*) AS n, MAX(ts) AS latest FROM samples").first();
      const alarm = await (await ensureScheduler(env)).json();
      return json({ meta: results, samples: row, scheduler: alarm });
    }

    // Debug: run the cron's code path on demand and surface any error
    if (url.pathname === "/api/poll" && req.method === "POST") {
      try {
        await samplePoll(env);
        return json({ ok: true });
      } catch (e) {
        return json({ ok: false, error: String(e) }, 500);
      }
    }

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

    // Per weekday: when do e-bikes first run out in the morning?
    // "Run out" = first minute of a >=10-min stretch at zero, between 4am and noon.
    if (url.pathname === "/api/runout") {
      const weeks = Math.min(Math.max(Number(url.searchParams.get("weeks")) || 8, 1), 26);
      const since = Math.floor(Date.now() / 1000) - weeks * 7 * 86400;
      const { results } = await env.DB.prepare(
        `SELECT ts, dow, minute, ebikes FROM samples
         WHERE ts >= ? AND dow BETWEEN 1 AND 5 AND minute >= 240 AND minute < 720
         ORDER BY ts`
      )
        .bind(since)
        .all();
      const byDay = new Map<number, { dow: number; s: [number, number][] }>();
      for (const r of results as { ts: number; dow: number; minute: number; ebikes: number }[]) {
        const key = Math.round((r.ts - r.minute * 60) / 86400); // local-midnight day key
        if (!byDay.has(key)) byDay.set(key, { dow: r.dow, s: [] });
        byDay.get(key)!.s.push([r.minute, r.ebikes]);
      }
      const perDow: Record<number, { mornings: number; ranOut: number[]; }> = {};
      for (let d = 1; d <= 5; d++) perDow[d] = { mornings: 0, ranOut: [] };
      for (const { dow, s } of byDay.values()) {
        if (s.length < 60) continue; // too little coverage to judge that morning
        perDow[dow].mornings++;
        s.sort((a, b) => a[0] - b[0]);
        let runStart = -1;
        for (const [m, eb] of s) {
          if (eb === 0) {
            if (runStart < 0) runStart = m;
            if (m - runStart >= 10) { perDow[dow].ranOut.push(runStart); break; }
          } else runStart = -1;
        }
      }
      const median = (a: number[]) => {
        const s = [...a].sort((x, y) => x - y);
        return s.length ? s[Math.floor((s.length - 1) / 2)] : null;
      };
      return json({
        station: STATION_NAME, weeks, windowMinutes: [240, 720],
        days: [1, 2, 3, 4, 5].map((d) => ({
          dow: d,
          mornings: perDow[d].mornings,
          ranOut: perDow[d].ranOut.length,
          medianMinute: median(perDow[d].ranOut),
        })),
      });
    }

    if (url.pathname === "/") {
      return new Response(PAGE_HTML, {
        headers: { "content-type": "text/html; charset=utf-8", "cache-control": "public, max-age=300" },
      });
    }

    return json({ error: "not found" }, 404);
  },
};
