import { Controller, Get, Query } from '@nestjs/common';
import { ArsoService } from './arso.service.js';

// Debug surface for the normalized ARSO data. The chat tool-loop (later phase)
// is the real consumer; these endpoints let us eyeball the normalized JSON.
// Auth comes from the global guard — the data itself is public.
@Controller('arso')
export class ArsoController {
  constructor(private readonly arso: ArsoService) {}

  /** Weather forecast for a Slovenian place (free-text; ARSO resolves it). */
  @Get('weather')
  weather(@Query('location') location?: string) {
    return this.arso.weatherForecast(location?.trim() || 'Ljubljana');
  }

  /** Latest hourly air quality; optional `station` substring filter. */
  @Get('air')
  air(@Query('station') station?: string) {
    return this.arso.airQuality(station);
  }

  /** Latest hydrology readings; optional `river`/station substring filter. */
  @Get('hydro')
  hydro(@Query('river') river?: string) {
    return this.arso.hydrology(river);
  }
}
