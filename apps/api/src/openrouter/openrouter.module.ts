import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { EncryptionService } from './encryption.service.js';
import { KeyResolverService } from './key-resolver.service.js';
import { OcrFallbackService } from './ocr-fallback.service.js';
import { OpenRouterProvisioningService } from './openrouter-provisioning.service.js';

@Module({
  imports: [ConfigModule],
  providers: [
    EncryptionService,
    OpenRouterProvisioningService,
    KeyResolverService,
    OcrFallbackService,
  ],
  exports: [
    EncryptionService,
    OpenRouterProvisioningService,
    KeyResolverService,
    OcrFallbackService,
  ],
})
export class OpenRouterModule {}
