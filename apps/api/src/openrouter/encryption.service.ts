import { Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

/**
 * AES-256-GCM symmetric encryption for at-rest secrets (OpenRouter
 * keys, BYOK provider keys, …).
 *
 * Ciphertext format (versioned):
 *   v1:<iv-hex>:<ciphertext-hex>:<authTag-hex>
 *
 * The version prefix lets us rotate the master key without rewriting
 * every column on the spot:
 *   - v1: encrypted with OPENROUTER_ENCRYPTION_KEY (current)
 *   - legacy (no prefix): encrypted with OPENROUTER_ENCRYPTION_KEY_PREVIOUS
 *     OR with the current key if no previous is set (first migration
 *     to the versioned scheme)
 *
 * To rotate:
 *   1. Set OPENROUTER_ENCRYPTION_KEY_PREVIOUS = old key, set
 *      OPENROUTER_ENCRYPTION_KEY = new key, restart.
 *   2. Decrypt still works for both v1 (new) and legacy (old) ciphertexts.
 *   3. Run the re-encrypt migration to lift legacy rows to v1 with the
 *      new key (packages/database/backfill/reencrypt-legacy-secrets.ts).
 *   4. Once migration completes, drop OPENROUTER_ENCRYPTION_KEY_PREVIOUS.
 *
 * Future bumps (v2, v3) can layer on the same prefix logic.
 */
@Injectable()
export class EncryptionService implements OnModuleInit {
  private currentKey!: Buffer;
  private previousKey: Buffer | null = null;

  constructor(private readonly configService: ConfigService) {}

  onModuleInit() {
    this.currentKey = this.requireKey('OPENROUTER_ENCRYPTION_KEY');
    const prevHex = this.configService.get<string>(
      'OPENROUTER_ENCRYPTION_KEY_PREVIOUS',
    );
    if (prevHex) {
      if (prevHex.length !== 64) {
        throw new Error(
          'OPENROUTER_ENCRYPTION_KEY_PREVIOUS must be exactly 64 hex characters (32 bytes)',
        );
      }
      this.previousKey = Buffer.from(prevHex, 'hex');
    }
  }

  private requireKey(envName: string): Buffer {
    const hex = this.configService.get<string>(envName);
    if (!hex || hex.length !== 64) {
      throw new Error(
        `${envName} must be exactly 64 hex characters (32 bytes)`,
      );
    }
    return Buffer.from(hex, 'hex');
  }

  encrypt(plaintext: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.currentKey, iv);
    const encrypted = Buffer.concat([
      cipher.update(plaintext, 'utf8'),
      cipher.final(),
    ]);
    const authTag = cipher.getAuthTag();
    return [
      'v1',
      iv.toString('hex'),
      encrypted.toString('hex'),
      authTag.toString('hex'),
    ].join(':');
  }

  /**
   * Whether `stored` is in the legacy (pre-versioned) format. Used by the
   * re-encryption migration to find rows that need lifting to v1.
   */
  static isLegacy(stored: string): boolean {
    return !stored.startsWith('v1:') && !stored.startsWith('v2:');
  }

  decrypt(stored: string): string {
    const parts = stored.split(':');

    // v1:<iv>:<ct>:<authTag>
    if (parts[0] === 'v1' && parts.length === 4) {
      return this.decryptWithKey(this.currentKey, parts[1], parts[2], parts[3]);
    }

    // Legacy (no version prefix): <iv>:<ct>:<authTag>
    if (parts.length === 3) {
      // Prefer previous key if rotation is in progress; fall back to
      // current (covers the common case where rotation hasn't happened).
      const keyToTry = this.previousKey ?? this.currentKey;
      try {
        return this.decryptWithKey(keyToTry, parts[0], parts[1], parts[2]);
      } catch (err) {
        // If we tried previous and it failed, also try current — covers
        // rotation periods where some rows are already on the new key.
        if (this.previousKey) {
          return this.decryptWithKey(
            this.currentKey,
            parts[0],
            parts[1],
            parts[2],
          );
        }
        throw err;
      }
    }

    throw new Error(
      `Unknown ciphertext format (parts: ${parts.length}, prefix: ${parts[0]})`,
    );
  }

  private decryptWithKey(
    key: Buffer,
    ivHex: string,
    ciphertextHex: string,
    authTagHex: string,
  ): string {
    const iv = Buffer.from(ivHex, 'hex');
    const ciphertext = Buffer.from(ciphertextHex, 'hex');
    const authTag = Buffer.from(authTagHex, 'hex');
    const decipher = createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(authTag);
    return Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]).toString('utf8');
  }
}
