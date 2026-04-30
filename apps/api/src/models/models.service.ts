import {
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { eq, inArray } from 'drizzle-orm';
import { enabledModels, modelConfigs, users } from '@worken/database/schema';
import { DATABASE, type Database } from '../database/database.module.js';
import {
  OpenRouterCatalogService,
  type CatalogModel,
} from './openrouter-catalog.service.js';

export interface CatalogEntry extends CatalogModel {
  enabled: boolean;
  enabledAt: Date | null;
}

@Injectable()
export class ModelsService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly catalogService: OpenRouterCatalogService,
  ) {}

  async findAll() {
    return this.db.select().from(modelConfigs);
  }

  /**
   * Admin view: full OpenRouter catalog with `enabled` flag joined from our
   * `enabled_models` table. Used to drive the admin toggle UI.
   */
  async listCatalog(callerId: string): Promise<CatalogEntry[]> {
    await this.assertAdmin(callerId);
    const [catalog, enabledRows] = await Promise.all([
      this.catalogService.list(),
      this.db.select().from(enabledModels),
    ]);
    const enabledMap = new Map(
      enabledRows.map((r) => [r.modelIdentifier, r.enabledAt] as const),
    );
    return catalog.map((m) => ({
      ...m,
      enabled: enabledMap.has(m.id),
      enabledAt: enabledMap.get(m.id) ?? null,
    }));
  }

  /**
   * End-user view: only the models the admin has enabled, intersected with
   * the live catalog (so a model that disappears from OpenRouter stops
   * showing up immediately). Returned in catalog order.
   */
  async listAvailable(): Promise<CatalogModel[]> {
    const [catalog, enabledRows] = await Promise.all([
      this.catalogService.list(),
      this.db.select({ id: enabledModels.modelIdentifier }).from(enabledModels),
    ]);
    if (enabledRows.length === 0) return [];
    const enabledIds = new Set(enabledRows.map((r) => r.id));
    return catalog.filter((m) => enabledIds.has(m.id));
  }

  /** Toggle a single model on/off. Admin-only. */
  async setEnabled(
    callerId: string,
    modelIdentifier: string,
    enabled: boolean,
  ): Promise<{ modelIdentifier: string; enabled: boolean }> {
    await this.assertAdmin(callerId);

    // Validate: the identifier must exist in the live catalog so we can't
    // enable a typo that no model resolves to.
    const catalog = await this.catalogService.list();
    if (!catalog.some((m) => m.id === modelIdentifier)) {
      throw new NotFoundException(
        `Model "${modelIdentifier}" not found in OpenRouter catalog`,
      );
    }

    if (enabled) {
      await this.db
        .insert(enabledModels)
        .values({ modelIdentifier, enabledById: callerId })
        .onConflictDoNothing();
    } else {
      await this.db
        .delete(enabledModels)
        .where(eq(enabledModels.modelIdentifier, modelIdentifier));
    }

    return { modelIdentifier, enabled };
  }

  /**
   * Bulk additive/subtractive: set every listed identifier to the given
   * enabled state, leave all other rows untouched. Used by the admin
   * "select N, then Enable/Disable selected" flow.
   */
  async setEnabledBatch(
    callerId: string,
    modelIdentifiers: string[],
    enabled: boolean,
  ): Promise<{ updated: string[]; enabled: boolean }> {
    await this.assertAdmin(callerId);

    if (modelIdentifiers.length === 0) {
      return { updated: [], enabled };
    }

    const catalog = await this.catalogService.list();
    const valid = new Set(catalog.map((m) => m.id));
    const unknown = modelIdentifiers.filter((id) => !valid.has(id));
    if (unknown.length > 0) {
      throw new NotFoundException(
        `Unknown model identifier(s): ${unknown.join(', ')}`,
      );
    }

    if (enabled) {
      // ON_CONFLICT DO NOTHING so re-enabling something already enabled
      // is a no-op rather than a constraint error.
      await this.db
        .insert(enabledModels)
        .values(
          modelIdentifiers.map((id) => ({
            modelIdentifier: id,
            enabledById: callerId,
          })),
        )
        .onConflictDoNothing();
    } else {
      await this.db
        .delete(enabledModels)
        .where(inArray(enabledModels.modelIdentifier, modelIdentifiers));
    }

    return { updated: modelIdentifiers, enabled };
  }

  private async assertAdmin(userId: string): Promise<void> {
    const [row] = await this.db
      .select({ role: users.role })
      .from(users)
      .where(eq(users.id, userId));
    if (!row || row.role !== 'admin') {
      throw new ForbiddenException('Admin role required');
    }
  }

  async create(
    ownerId: string,
    data: {
      customName: string;
      modelIdentifier: string;
      fallbackModels?: string[];
      integrationId?: string | null;
    },
  ) {
    const [model] = await this.db
      .insert(modelConfigs)
      .values({
        ownerId,
        customName: data.customName,
        modelIdentifier: data.modelIdentifier,
        fallbackModels: data.fallbackModels ?? [],
        integrationId: data.integrationId ?? null,
      })
      .returning();

    return model;
  }

  async update(
    id: string,
    userId: string,
    data: {
      customName?: string;
      modelIdentifier?: string;
      isActive?: boolean;
      fallbackModels?: string[];
      integrationId?: string | null;
    },
  ) {
    const [model] = await this.db
      .select()
      .from(modelConfigs)
      .where(eq(modelConfigs.id, id));

    if (!model) throw new NotFoundException('Model config not found');
    if (model.ownerId !== userId) {
      throw new ForbiddenException('Only the owner can update this model');
    }

    const updates: Record<string, unknown> = {};
    if (data.customName !== undefined) updates.customName = data.customName;
    if (data.modelIdentifier !== undefined)
      updates.modelIdentifier = data.modelIdentifier;
    if (data.isActive !== undefined) updates.isActive = data.isActive;
    if (data.fallbackModels !== undefined)
      updates.fallbackModels = data.fallbackModels;
    if (data.integrationId !== undefined)
      updates.integrationId = data.integrationId;

    if (Object.keys(updates).length === 0) return model;

    const [updated] = await this.db
      .update(modelConfigs)
      .set(updates)
      .where(eq(modelConfigs.id, id))
      .returning();

    return updated;
  }

  async remove(id: string, userId: string) {
    const [model] = await this.db
      .select()
      .from(modelConfigs)
      .where(eq(modelConfigs.id, id));

    if (!model) throw new NotFoundException('Model config not found');
    if (model.ownerId !== userId) {
      throw new ForbiddenException('Only the owner can delete this model');
    }

    await this.db.delete(modelConfigs).where(eq(modelConfigs.id, id));
    return { success: true };
  }
}
