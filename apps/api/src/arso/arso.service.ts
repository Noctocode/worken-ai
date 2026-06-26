import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { XMLParser } from 'fast-xml-parser';
import {
  ARSO_ATTRIBUTION,
  type ArsoAirReading,
  type ArsoAirResult,
  type ArsoForecastPoint,
  type ArsoHydroReading,
  type ArsoHydroResult,
  type ArsoWeatherResult,
} from './arso.types.js';

const WEATHER_URL = (location: string) =>
  `https://vreme.arso.gov.si/api/1.0/location/?location=${encodeURIComponent(location)}`;
const AIR_URL =
  'https://www.arso.gov.si/xml/zrak/ones_zrak_urni_podatki_zadnji.xml';
const HYDRO_URL = 'https://www.arso.gov.si/xml/vode/hidro_podatki_zadnji.xml';

const FETCH_TIMEOUT_MS = 8000;
const CACHE_TTL_MS = 30 * 60 * 1000; // ARSO refreshes ~30–60 min

/**
 * Fetches + normalizes public ARSO environmental data (weather forecast, air
 * quality, hydrology). No API key — ARSO is open. In-memory TTL cache keeps us
 * a good citizen (the data only changes ~every 30 min) and makes repeat calls
 * instant. The chat tool-loop (later phase) calls these methods; for now a
 * debug controller exposes them.
 */
@Injectable()
export class ArsoService {
  private readonly logger = new Logger(ArsoService.name);
  private readonly cache = new Map<string, { at: number; data: unknown }>();
  private readonly xml = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '',
    trimValues: true,
  });

  // ── helpers ──────────────────────────────────────────────────────────────

  private async fetchText(url: string): Promise<string> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
    try {
      // ARSO blocks requests without a User-Agent.
      const res = await fetch(url, {
        signal: ctrl.signal,
        headers: {
          'User-Agent': 'WorkenAI/1.0 (+https://workenai.com)',
          Accept: 'application/json, application/xml, text/xml',
        },
        redirect: 'follow',
      });
      if (!res.ok) throw new Error(`ARSO responded ${res.status} for ${url}`);
      return await res.text();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`ARSO fetch failed (${url}): ${msg}`);
      throw new ServiceUnavailableException(
        'ARSO data is currently unavailable.',
      );
    } finally {
      clearTimeout(timer);
    }
  }

  private async cached<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const hit = this.cache.get(key);
    if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.data as T;
    const data = await fn();
    this.cache.set(key, { at: Date.now(), data });
    return data;
  }

  private num(v: unknown): number | null {
    if (v === null || v === undefined || v === '') return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }

  private str(v: unknown): string | null {
    if (v === null || v === undefined) return null;
    // Only flatten primitives — an object here means a nested XML element,
    // which we must not coerce to "[object Object]" (and satisfies
    // @typescript-eslint/no-base-to-string).
    if (
      typeof v !== 'string' &&
      typeof v !== 'number' &&
      typeof v !== 'boolean'
    ) {
      return null;
    }
    let s = String(v).trim();
    if (s === '') return null;
    // Some ARSO feeds (hydrology) write č/š/ž as numeric XML entities
    // (e.g. "&#x010C;rne&#x010D;e" → "Črneče") which the parser leaves raw.
    s = s
      .replace(/&#x([0-9a-fA-F]+);/g, (_, h) =>
        String.fromCodePoint(parseInt(h, 16)),
      )
      .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)));
    return s;
  }

  /** fast-xml-parser yields an object for a single child, an array for many. */
  private arr<T>(v: unknown): T[] {
    if (v === undefined || v === null) return [];
    return (Array.isArray(v) ? v : [v]) as T[];
  }

  // ── weather ──────────────────────────────────────────────────────────────

  async weatherForecast(location: string): Promise<ArsoWeatherResult> {
    const place = location.trim();
    if (!place) throw new ServiceUnavailableException('Location is required.');
    return this.cached(`weather:${place.toLowerCase()}`, async () => {
      const json = JSON.parse(await this.fetchText(WEATHER_URL(place)));
      const feature = json?.forecast3h?.features?.[0] ?? {};
      const props = feature.properties ?? {};
      const [lon, lat] = feature.geometry?.coordinates ?? [null, null];
      const points: ArsoForecastPoint[] = [];
      for (const day of this.arr<Record<string, unknown>>(props.days)) {
        for (const e of this.arr<Record<string, unknown>>(day.timeline)) {
          points.push({
            time: this.str(e.valid),
            tempC: this.num(e.t),
            weather:
              this.str(e.wwsyn_shortText) ?? this.str(e.clouds_shortText),
            windDir: this.str(e.dd_shortText),
            windSpeedKmh: this.num(e.ff_val),
            humidityPct: this.num(e.rh),
          });
        }
      }
      return {
        source: ARSO_ATTRIBUTION,
        location: this.str(props.title) ?? place,
        lat: this.num(lat),
        lon: this.num(lon),
        forecast: points,
      };
    });
  }

  // ── air quality ──────────────────────────────────────────────────────────

  private mapAir(p: Record<string, unknown>): ArsoAirReading {
    return {
      station: this.str(p.merilno_mesto) ?? '',
      code: this.str(p.sifra) ?? '',
      lat: this.num(p.wgs84_sirina),
      lon: this.num(p.wgs84_dolzina),
      from: this.str(p.datum_od),
      to: this.str(p.datum_do),
      pm10: this.num(p.pm10),
      pm25: this.num(p['pm2.5']),
      o3: this.num(p.o3),
      no2: this.num(p.no2),
      so2: this.num(p.so2),
      co: this.num(p.co),
      benzene: this.num(p.benzen),
      nox: this.num(p.nox),
    };
  }

  async airQuality(filter?: string): Promise<ArsoAirResult> {
    const data = await this.cached('air', async () => {
      const root =
        this.xml.parse(await this.fetchText(AIR_URL)).arsopodatki ?? {};
      return {
        updated: this.str(root.datum_priprave),
        readings: this.arr<Record<string, unknown>>(root.postaja).map((p) =>
          this.mapAir(p),
        ),
      };
    });
    return {
      source: ARSO_ATTRIBUTION,
      updated: data.updated,
      // Station names start with a region code/name ("LJ Bežigrad", "Kranj")
      // — prefix-match so "LJ" doesn't also catch "Trbovlje"/"Črnomelj".
      readings: this.applyFilter(
        data.readings,
        filter,
        (r) => r.station,
        'startsWith',
      ),
    };
  }

  // ── hydrology ────────────────────────────────────────────────────────────

  private mapHydro(p: Record<string, unknown>): ArsoHydroReading {
    return {
      station: this.str(p.merilno_mesto) ?? '',
      code: this.str(p.sifra) ?? '',
      river: this.str(p.reka),
      shortName: this.str(p.ime_kratko),
      datetime: this.str(p.datum),
      waterLevelCm: this.num(p.vodostaj),
      flowM3s: this.num(p.pretok),
      characteristic: this.str(p.pretok_znacilni),
      waterTempC: this.num(p.temp_vode),
      lat: this.num(p.wgs84_sirina),
      lon: this.num(p.wgs84_dolzina),
    };
  }

  async hydrology(filter?: string): Promise<ArsoHydroResult> {
    const data = await this.cached('hydro', async () => {
      const root =
        this.xml.parse(await this.fetchText(HYDRO_URL)).arsopodatki ?? {};
      return {
        updated: this.str(root.datum_priprave),
        readings: this.arr<Record<string, unknown>>(root.postaja).map((p) =>
          this.mapHydro(p),
        ),
      };
    });
    return {
      source: ARSO_ATTRIBUTION,
      updated: data.updated,
      // Match either the station place or the river name.
      readings: this.applyFilter(
        data.readings,
        filter,
        (r) => `${r.river ?? ''} ${r.station}`,
      ),
    };
  }

  private applyFilter<T>(
    rows: T[],
    filter: string | undefined,
    haystack: (row: T) => string,
    mode: 'includes' | 'startsWith' = 'includes',
  ): T[] {
    const q = filter?.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => {
      const h = haystack(r).toLowerCase();
      return mode === 'startsWith' ? h.startsWith(q) : h.includes(q);
    });
  }
}
