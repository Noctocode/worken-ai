// Normalized ARSO (Agencija RS za okolje) data shapes. ARSO data is public
// and free to reuse — every response carries this attribution.
export const ARSO_ATTRIBUTION = 'Vir: Agencija RS za okolje (ARSO)';

/** One air-quality station's latest hourly readings (µg/m³, CO in mg/m³). */
export interface ArsoAirReading {
  station: string; // merilno_mesto, e.g. "LJ Bežigrad"
  code: string; // sifra
  lat: number | null;
  lon: number | null;
  from: string | null; // datum_od
  to: string | null; // datum_do
  pm10: number | null;
  pm25: number | null;
  o3: number | null;
  no2: number | null;
  so2: number | null;
  co: number | null;
  benzene: number | null;
  nox: number | null;
}

export interface ArsoAirResult {
  source: string;
  updated: string | null; // datum_priprave
  readings: ArsoAirReading[];
}

/** One hydrology station's latest reading. */
export interface ArsoHydroReading {
  station: string; // merilno_mesto
  code: string; // sifra
  river: string | null; // reka
  shortName: string | null; // ime_kratko
  datetime: string | null; // datum
  waterLevelCm: number | null; // vodostaj
  flowM3s: number | null; // pretok
  characteristic: string | null; // pretok_znacilni, e.g. "mali pretok"
  waterTempC: number | null; // temp_vode
  lat: number | null;
  lon: number | null;
}

export interface ArsoHydroResult {
  source: string;
  updated: string | null;
  readings: ArsoHydroReading[];
}

/** A single point in a weather forecast timeline. */
export interface ArsoForecastPoint {
  time: string | null; // valid (ISO)
  tempC: number | null;
  weather: string | null; // human summary (clouds / wwsyn shortText)
  windDir: string | null;
  windSpeedKmh: number | null;
  humidityPct: number | null;
}

export interface ArsoWeatherResult {
  source: string;
  location: string;
  lat: number | null;
  lon: number | null;
  forecast: ArsoForecastPoint[];
}
