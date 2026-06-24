// Provider-agnostic tool (function-calling) definitions for the ARSO data.
// Phase C adapts these to the OpenAI-SDK / Anthropic tool shapes; here they're
// plain { name, description, parameters(JSON Schema) } so the model knows what
// it can call and when.

export interface ArsoToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export const ARSO_TOOLS: ArsoToolDefinition[] = [
  {
    name: 'arso_weather_forecast',
    description:
      'Get the weather forecast and current conditions for a place in Slovenia (source: ARSO). Use for any question about weather, temperature, wind, clouds or rain in Slovenia.',
    parameters: {
      type: 'object',
      required: ['location'],
      properties: {
        location: {
          type: 'string',
          description:
            'A place in Slovenia, e.g. "Ljubljana", "Maribor", "Bled", "Kranjska Gora".',
        },
      },
    },
  },
  {
    name: 'arso_air_quality',
    description:
      'Get the latest hourly air-quality measurements (PM10, PM2.5, ozone, NO2, CO) for Slovenia from ARSO. Use for questions about air pollution / air quality. Omit `location` to get every station.',
    parameters: {
      type: 'object',
      properties: {
        location: {
          type: 'string',
          description:
            'A Slovenian city/place, e.g. "Ljubljana", "Maribor", "Celje", "Koper". Omit for all stations.',
        },
      },
    },
  },
  {
    name: 'arso_river_level',
    description:
      'Get the latest river water level, flow and water temperature for Slovenian rivers/stations from ARSO. Use for questions about water levels, river flow or flooding. Omit `query` for every station.',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description:
            'A river or place name, e.g. "Sava", "Drava", "Ljubljanica", "Kranjska Gora". Omit for all stations.',
        },
      },
    },
  },
];

// ── Curated location → ARSO air-quality station resolution ──────────────────
// The air-quality XML is keyed by station names like "LJ Bežigrad" / "MB
// Titova", so a free-text place ("Ljubljana") won't substring-match. Map the
// main cities to the station-name prefix the feed uses; unknown places fall
// through to a raw substring match. Weather resolves free-text on ARSO's side
// (no map needed); hydrology matches river/station names directly.
const AIR_STATION_BY_PLACE: Record<string, string> = {
  ljubljana: 'LJ',
  maribor: 'MB',
  celje: 'CE',
  kranj: 'Kranj',
  koper: 'Koper',
  capodistria: 'Koper',
  'nova gorica': 'Nova Gorica',
  'murska sobota': 'Murska Sobota',
  'novo mesto': 'Novo mesto',
  ptuj: 'Ptuj',
  trbovlje: 'Trbovlje',
  zagorje: 'Zagorje',
  hrastnik: 'Hrastnik',
  'velenje': 'Velenje',
  iskrba: 'Iskrba',
};

/** Resolve a free-text place to the air-station substring filter, if known. */
export function resolveAirStation(location?: string): string | undefined {
  const place = location?.trim().toLowerCase();
  if (!place) return undefined;
  return AIR_STATION_BY_PLACE[place] ?? location?.trim();
}
