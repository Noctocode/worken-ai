import { BadRequestException, Injectable } from '@nestjs/common';
import { ArsoService } from './arso.service.js';
import {
  ARSO_TOOLS,
  resolveAirStation,
  type ArsoToolDefinition,
} from './arso-tools.js';

/**
 * Maps a model-issued ARSO tool call (name + args) to the right ArsoService
 * method, doing the free-text → station resolution. Phase C's chat tool-loop
 * calls `dispatch`; `definitions` feeds the model the available tools.
 */
@Injectable()
export class ArsoToolsService {
  constructor(private readonly arso: ArsoService) {}

  definitions(): ArsoToolDefinition[] {
    return ARSO_TOOLS;
  }

  private str(v: unknown): string | undefined {
    if (typeof v !== 'string') return undefined;
    const s = v.trim();
    return s === '' ? undefined : s;
  }

  async dispatch(
    name: string,
    args: Record<string, unknown> = {},
  ): Promise<unknown> {
    switch (name) {
      case 'arso_weather_forecast': {
        const location = this.str(args.location);
        if (!location) {
          throw new BadRequestException(
            '`location` is required for arso_weather_forecast.',
          );
        }
        return this.arso.weatherForecast(location);
      }
      case 'arso_air_quality':
        return this.arso.airQuality(resolveAirStation(this.str(args.location)));
      case 'arso_river_level':
        return this.arso.hydrology(this.str(args.query));
      default:
        throw new BadRequestException(`Unknown ARSO tool "${name}".`);
    }
  }
}
