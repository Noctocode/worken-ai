import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class OpenRouterProvisioningService {
  private readonly provisioningKey: string;

  constructor(private readonly configService: ConfigService) {
    this.provisioningKey =
      this.configService.get<string>('OPENROUTER_PROVISIONING_KEY') ?? '';
  }

  async createKey(
    name: string,
    creditLimitUsd: number,
  ): Promise<{ key: string; hash: string }> {
    const response = await fetch('https://openrouter.ai/api/v1/keys', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.provisioningKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name,
        credit_limit: creditLimitUsd,
        limit_reset: 'monthly',
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(
        `OpenRouter key creation failed: ${response.status} ${text}`,
      );
    }

    const data = (await response.json()) as {
      key: string;
      data: { hash: string };
    };
    return { key: data.key, hash: data.data.hash };
  }

  async updateKey(hash: string, creditLimitUsd: number): Promise<void> {
    const response = await fetch(`https://openrouter.ai/api/v1/keys/${hash}`, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${this.provisioningKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ credit_limit: creditLimitUsd }),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(
        `OpenRouter key update failed: ${response.status} ${text}`,
      );
    }
  }

  /** Fetch current-period usage for a provisioned key. */
  async getKeyUsage(
    hash: string,
  ): Promise<{ usageCents: number; limitCents: number } | null> {
    // TODO: Replace with real OpenRouter usage API when available.
    // OpenRouter does not currently expose per-key usage via a public endpoint.
    // For now return null so callers can fall back to mock/placeholder data.
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
    const response = await fetch(`https://openrouter.ai/api/v1/keys/${hash}`, {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${this.provisioningKey}`,
      },
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(
        `OpenRouter key deletion failed: ${response.status} ${text}`,
      );
    }
  }
}
