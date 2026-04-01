import {
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { modelConfigs } from '@worken/database/schema';
import { DATABASE, type Database } from '../database/database.module.js';

@Injectable()
export class ModelsService {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async findAll() {
    return this.db.select().from(modelConfigs);
  }

  async create(
    ownerId: string,
    data: {
      customName: string;
      modelIdentifier: string;
      fallbackModels?: string[];
    },
  ) {
    const [model] = await this.db
      .insert(modelConfigs)
      .values({
        ownerId,
        customName: data.customName,
        modelIdentifier: data.modelIdentifier,
        fallbackModels: data.fallbackModels ?? [],
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
