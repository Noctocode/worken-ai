import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { ArsoService } from './arso.service.js';
import { ArsoToolsService } from './arso-tools.service.js';

// Debug surface for the normalized ARSO data + the tool layer. The chat
// tool-loop (later phase) is the real consumer; these endpoints let us eyeball
// the normalized JSON and dry-run a tool call. Auth comes from the global
// guard — the data itself is public.
@Controller('arso')
export class ArsoController {
  constructor(
    private readonly arso: ArsoService,
    private readonly tools: ArsoToolsService,
  ) {}

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

  /** The function-calling tool definitions the model will be offered. */
  @Get('tools')
  toolDefinitions() {
    return this.tools.definitions();
  }

  /** Dry-run a tool call: { name, arguments } → the tool's result. */
  @Post('tool-test')
  toolTest(
    @Body() body: { name?: string; arguments?: Record<string, unknown> },
  ) {
    return this.tools.dispatch(body?.name ?? '', body?.arguments ?? {});
  }
}
