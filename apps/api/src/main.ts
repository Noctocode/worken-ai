import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import type { NextFunction, Request, Response } from 'express';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  app.use(cookieParser());

  // Trust the reverse-proxy chain so `req.ip` is the real client (used by
  // the auth rate limiter). Production is Cloudflare → Caddy → api = 2
  // hops; set TRUST_PROXY_HOPS=0 locally (no proxy). A numeric value
  // counts trusted hops from the right, so a spoofed X-Forwarded-For
  // entry on the left can't masquerade as the client.
  app.set('trust proxy', Number(process.env.TRUST_PROXY_HOPS ?? 2));

  // Temporary: flip LOG_PROXY_IP=true in prod for one request to confirm
  // the hop count, then remove. Logs the forwarding chain vs resolved IP.
  if (process.env.LOG_PROXY_IP === 'true') {
    app.use((req: Request, _res: Response, next: NextFunction) => {
      console.log('XFF:', req.headers['x-forwarded-for']);
      console.log('CF-Connecting-IP:', req.headers['cf-connecting-ip']);
      console.log('resolved req.ip:', req.ip);
      next();
    });
  }

  app.enableCors({
    origin: process.env.FRONTEND_URL || 'http://localhost:3000',
    credentials: true,
  });
  await app.listen(process.env.PORT ?? 3001);
}
void bootstrap();
