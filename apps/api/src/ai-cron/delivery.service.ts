import { Injectable, Logger } from '@nestjs/common';
import { scheduledPrompts } from '@worken/database/schema';

export interface DeliveryPayload {
  runId: string;
  output: string;
  citations?: { url: string; title?: string }[];
}

/**
 * Delivers a finished run's output over the channels the job enabled.
 *
 * Commit-6 stub: intentionally a no-op so the runner is end-to-end testable
 * (a run is created, executed, and recorded) without the delivery surface.
 * Commit 7 replaces this with the real in-app / email / webhook channels
 * (including the webhook SSRF + DNS-rebinding defenses).
 */
@Injectable()
export class DeliveryService {
  private readonly logger = new Logger(DeliveryService.name);

  deliver(
    prompt: typeof scheduledPrompts.$inferSelect,
    payload: DeliveryPayload,
  ): Promise<Record<string, string>> {
    this.logger.debug(
      `Delivery stub for run ${payload.runId} of "${prompt.name}" — channels wired in commit 7.`,
    );
    return Promise.resolve({});
  }
}
