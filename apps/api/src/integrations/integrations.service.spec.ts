import { BadRequestException } from '@nestjs/common';
import { IntegrationsService } from './integrations.service.js';

/* ─── assertEnableHasKey (pure decision) ────────────────────────────── */

/**
 * Builds a service instance just to call the public assertEnableHasKey
 * — it doesn't need DB or encryption to evaluate the policy. Cleaner
 * than re-exporting the helper as a top-level function and means the
 * tests track the exact callable shape used in upsert/update.
 */
function svc() {
  return new IntegrationsService(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    {} as any, // db unused
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    {} as any, // encryption unused
  );
}

describe('IntegrationsService.assertEnableHasKey', () => {
  it('passes disabling regardless of key presence', () => {
    expect(() =>
      svc().assertEnableHasKey({
        providerId: 'anthropic',
        existingKey: null,
        existingEnabled: true,
        inputApiKey: undefined,
        nextApiKeyEncrypted: null,
        inputEnabled: false,
      }),
    ).not.toThrow();
  });

  it('passes when input adds a key alongside enable=true', () => {
    expect(() =>
      svc().assertEnableHasKey({
        providerId: 'anthropic',
        existingKey: null,
        existingEnabled: false,
        inputApiKey: 'sk-…',
        nextApiKeyEncrypted: 'encrypted',
        inputEnabled: true,
      }),
    ).not.toThrow();
  });

  it('passes when existing key is preserved (input.apiKey undefined) and re-enabled', () => {
    // Toggle-only patch from a card row that already has a saved key.
    expect(() =>
      svc().assertEnableHasKey({
        providerId: 'anthropic',
        existingKey: 'encrypted',
        existingEnabled: false,
        inputApiKey: undefined,
        nextApiKeyEncrypted: null,
        inputEnabled: true,
      }),
    ).not.toThrow();
  });

  it('blocks enable=true when no key exists and none being entered', () => {
    expect(() =>
      svc().assertEnableHasKey({
        providerId: 'anthropic',
        existingKey: null,
        existingEnabled: false,
        inputApiKey: undefined,
        nextApiKeyEncrypted: null,
        inputEnabled: true,
      }),
    ).toThrow(BadRequestException);
  });

  it('blocks enable=true when caller is clearing an existing key', () => {
    // The footgun: row had a key + was disabled, caller flips Enabled
    // on AND clears the key in the same request. Must reject — the
    // post-write state would be enabled-no-key.
    expect(() =>
      svc().assertEnableHasKey({
        providerId: 'anthropic',
        existingKey: 'encrypted',
        existingEnabled: false,
        inputApiKey: null, // explicit clear
        nextApiKeyEncrypted: null,
        inputEnabled: true,
      }),
    ).toThrow(BadRequestException);
  });

  it('passes when row already enabled + key (existing enabled stays, no apiKey input)', () => {
    // Pure no-op style patch (e.g. just renaming via metadata, which
    // we don't have here, but we still don't want to false-trip).
    expect(() =>
      svc().assertEnableHasKey({
        providerId: 'anthropic',
        existingKey: 'encrypted',
        existingEnabled: true,
        inputApiKey: undefined,
        nextApiKeyEncrypted: null,
        inputEnabled: undefined,
      }),
    ).not.toThrow();
  });

  it('blocks legacy enabled-no-key row when caller leaves enabled untouched', () => {
    // Pre-existing legacy state: someone enabled this row before the
    // gate landed, no key. A subsequent PATCH that doesn't touch
    // isEnabled must NOT save through silently — the row would still
    // be in the bad state. The personal Integration tab is what
    // surfaces the recovery path (disable, then add key, then enable).
    expect(() =>
      svc().assertEnableHasKey({
        providerId: 'anthropic',
        existingKey: null,
        existingEnabled: true,
        inputApiKey: undefined,
        nextApiKeyEncrypted: null,
        inputEnabled: undefined,
      }),
    ).toThrow(BadRequestException);
  });
});
