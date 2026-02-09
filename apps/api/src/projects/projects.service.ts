import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { desc, eq } from 'drizzle-orm';
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

  async findAll() {
    return this.db.select().from(projects).orderBy(desc(projects.createdAt));
  }

  async findOne(id: string) {
    const [project] = await this.db
      .select()
      .from(projects)
      .where(eq(projects.id, id));
    if (!project) {
      throw new NotFoundException(`Project ${id} not found`);
    }
    return project;
  }

  async create(dto: CreateProjectDto) {
    const [project] = await this.db
      .insert(projects)
      .values({
        name: dto.name,
        description: dto.description,
        model: dto.model,
      })
      .returning();
    return project;
  }
}
