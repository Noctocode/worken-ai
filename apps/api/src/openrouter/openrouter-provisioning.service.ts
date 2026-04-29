import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class OpenRouterProvisioningService {
  private readonly provisioningKey: string;

  constructor(private readonly configService: ConfigService) {
    this.provisioningKey =
      this.configService.get<string>('OPENROUTER_PROVISIONING_KEY') ?? '';
  }

  private assertProvisioningKey(action: string): void {
    if (!this.provisioningKey) {
      throw new Error(
        `Cannot ${action}: OPENROUTER_PROVISIONING_KEY env var is not set. Add it to .env and restart the API.`,
      );
    }
  }

  async createKey(
    name: string,
    creditLimitUsd: number,
  ): Promise<{ key: string; hash: string }> {
    this.assertProvisioningKey('provision OpenRouter key');

    const response = await fetch('https://openrouter.ai/api/v1/keys', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.provisioningKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name,
        limit: creditLimitUsd,
        limit_reset: 'monthly',
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(
        `OpenRouter key creation failed (name="${name}"): ${response.status} ${response.statusText} — ${text}`,
      );
    }

    const data = (await response.json()) as {
      key: string;
      data: { hash: string };
    };
    return { key: data.key, hash: data.data.hash };
  }

  async updateKey(hash: string, creditLimitUsd: number): Promise<void> {
    this.assertProvisioningKey('update OpenRouter key');

    const response = await fetch(`https://openrouter.ai/api/v1/keys/${hash}`, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${this.provisioningKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ limit: creditLimitUsd }),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(
        `OpenRouter key update failed (hash=${hash}): ${response.status} ${response.statusText} — ${text}`,
      );
    }
  }

  /**
   * Fetch current-period usage for a provisioned key.
   * Reads `data.usage` and `data.limit` from `GET /keys/:hash`. Returns
   * null when the key has no limit set (legacy keys provisioned before
   * the credit_limit→limit fix), so callers can render "unknown" rather
   * than misleading zeros.
   */
  async getKeyUsage(
    hash: string,
  ): Promise<{ usageCents: number; limitCents: number } | null> {
    try {
      const response = await fetch(
        `https://openrouter.ai/api/v1/keys/${hash}`,
        {
          headers: {
            Authorization: `Bearer ${this.provisioningKey}`,
          },
        },
      );
      if (!response.ok) return null;
      const data = (await response.json()) as {
        data?: { usage?: number; limit?: number };
      };
      if (data.data?.usage != null && data.data?.limit != null) {
        return {
          usageCents: Math.round(data.data.usage * 100),
          limitCents: Math.round(data.data.limit * 100),
        };
      }
      return null;
    } catch {
      return null;
    }
  }

  async deleteKey(hash: string): Promise<void> {
    this.assertProvisioningKey('delete OpenRouter key');

    const response = await fetch(`https://openrouter.ai/api/v1/keys/${hash}`, {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${this.provisioningKey}`,
      },
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(
        `OpenRouter key deletion failed (hash=${hash}): ${response.status} ${response.statusText} — ${text}`,
      );
    }
  }
}
