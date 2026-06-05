import { Controller, HttpCode, INestApplication, Post } from '@nestjs/common';
import { ThrottlerModule } from '@nestjs/throttler';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { buildThrottlerOptions } from './throttler.options';
import {
  ThrottleForgotPassword,
  ThrottleLogin,
  ThrottleResendVerification,
  ThrottleSignup,
} from './throttle-auth.decorators';

// Mirrors the real auth routes' decorators on trivial handlers so we can
// exercise the limiter without standing up the DB / mail stack. No
// `storage` is passed to buildThrottlerOptions, so the throttler uses its
// in-memory store — a fresh one per app, which beforeEach recreates.
@Controller('auth')
class StubAuthController {
  // Handlers are trivial; the email/IP trackers read `req.body`/`req.ip`
  // directly off the request, so no @Body() param is needed here.
  @ThrottleLogin()
  @HttpCode(200)
  @Post('login')
  login() {
    return { ok: true };
  }

  @ThrottleSignup()
  @HttpCode(200)
  @Post('signup')
  signup() {
    return { ok: true };
  }

  @ThrottleResendVerification()
  @HttpCode(200)
  @Post('resend-verification')
  resend() {
    return { ok: true };
  }

  @ThrottleForgotPassword()
  @HttpCode(200)
  @Post('forgot-password')
  forgot() {
    return { ok: true };
  }
}

async function makeApp(): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({
    imports: [ThrottlerModule.forRoot(buildThrottlerOptions())],
    controllers: [StubAuthController],
  }).compile();
  const app = moduleRef.createNestApplication();
  await app.init();
  return app;
}

describe('auth rate limiting', () => {
  let app: INestApplication;

  afterEach(async () => {
    delete process.env.RATE_LIMIT_DISABLED;
    if (app) await app.close();
  });

  it('blocks /auth/login after 5 requests/min from one IP and sets Retry-After', async () => {
    app = await makeApp();
    const server = app.getHttpServer();
    const body = { email: 'attacker@example.com', password: 'x' };

    for (let i = 0; i < 5; i++) {
      await request(server).post('/auth/login').send(body).expect(200);
    }
    const blocked = await request(server)
      .post('/auth/login')
      .send(body)
      .expect(429);
    expect(blocked.headers['retry-after']).toBeDefined();
  });

  it('lets a legitimate user through each endpoint once', async () => {
    app = await makeApp();
    const server = app.getHttpServer();
    const email = 'real.user@example.com';

    await request(server).post('/auth/signup').send({ email }).expect(200);
    await request(server)
      .post('/auth/resend-verification')
      .send({ email })
      .expect(200);
    await request(server).post('/auth/login').send({ email }).expect(200);
    await request(server)
      .post('/auth/forgot-password')
      .send({ email })
      .expect(200);
  });

  it('hitting the login limit does not throttle other endpoints', async () => {
    app = await makeApp();
    const server = app.getHttpServer();

    // Exhaust login (6th would 429)…
    for (let i = 0; i < 6; i++) {
      await request(server).post('/auth/login').send({ email: 'a@b.com' });
    }
    // …signup is governed by its own named throttlers and stays open.
    await request(server)
      .post('/auth/signup')
      .send({ email: 'a@b.com' })
      .expect(200);
  });

  it('RATE_LIMIT_DISABLED=true bypasses limits outside production', async () => {
    process.env.RATE_LIMIT_DISABLED = 'true';
    app = await makeApp();
    const server = app.getHttpServer();
    const body = { email: 'flood@example.com' };

    for (let i = 0; i < 8; i++) {
      await request(server).post('/auth/login').send(body).expect(200);
    }
  });
});
