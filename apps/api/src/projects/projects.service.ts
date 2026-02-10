import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, desc, eq } from 'drizzle-orm';
import { projects } from '@worken/database/schema';
import { DATABASE, type Database } from '../database/database.module.js';

export interface CreateProjectDto {
  name: string;
  description?: string;
  model: string;
}

@Injectable()
export class ProjectsService {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async findAll(userId: string) {
    return this.db
      .select()
      .from(projects)
      .where(eq(projects.userId, userId))
      .orderBy(desc(projects.createdAt));
  }

  async findOne(id: string, userId: string) {
    const [project] = await this.db
      .select()
      .from(projects)
      .where(and(eq(projects.id, id), eq(projects.userId, userId)));
    if (!project) {
      throw new NotFoundException(`Project ${id} not found`);
    }
    return project;
  }

  async create(dto: CreateProjectDto, userId: string) {
    const [project] = await this.db
      .insert(projects)
      .values({
        name: dto.name,
        description: dto.description,
        model: dto.model,
        userId,
      })
      .returning();
    return project;
  }
}
