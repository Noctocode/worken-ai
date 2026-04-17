import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { eq, desc, sql, and } from 'drizzle-orm';
import {
  tenders,
  tenderRequirements,
  tenderDocuments,
  tenderTeamMembers,
  users,
} from '@worken/database/schema';
import { DATABASE, type Database } from '../database/database.module.js';

interface CreateTenderDto {
  name: string;
  code?: string;
  organization?: string;
  description?: string;
  category?: string;
  deadline?: string;
  value?: string;
  requirements?: {
    title: string;
    priority: string;
  }[];
  teamMemberIds?: string[];
}

interface UpdateTenderDto {
  name?: string;
  organization?: string;
  description?: string;
  category?: string;
  deadline?: string;
  value?: string;
  matchRate?: number;
  status?: string;
}

@Injectable()
export class TendersService {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async findAll(userId: string) {
    const rows = await this.db
      .select({
        id: tenders.id,
        code: tenders.code,
        name: tenders.name,
        organization: tenders.organization,
        description: tenders.description,
        category: tenders.category,
        deadline: tenders.deadline,
        value: tenders.value,
        matchRate: tenders.matchRate,
        status: tenders.status,
        ownerId: tenders.ownerId,
        createdAt: tenders.createdAt,
        updatedAt: tenders.updatedAt,
        ownerName: users.name,
        requirementCount: sql<number>`(
          SELECT count(*) FROM tender_requirements
          WHERE tender_requirements.tender_id = ${tenders.id}
        )`.as('requirement_count'),
        gapCount: sql<number>`(
          SELECT count(*) FROM tender_requirements
          WHERE tender_requirements.tender_id = ${tenders.id}
          AND tender_requirements.status = 'gap'
        )`.as('gap_count'),
      })
      .from(tenders)
      .leftJoin(users, eq(users.id, tenders.ownerId))
      .orderBy(desc(tenders.createdAt));

    return rows.map((r) => ({
      ...r,
      requirementCount: Number(r.requirementCount),
      gapCount: Number(r.gapCount),
    }));
  }

  async findOne(id: string) {
    const [tender] = await this.db
      .select()
      .from(tenders)
      .where(eq(tenders.id, id));

    if (!tender) throw new NotFoundException('Tender not found');

    const requirements = await this.db
      .select()
      .from(tenderRequirements)
      .where(eq(tenderRequirements.tenderId, id));

    const docs = await this.db
      .select()
      .from(tenderDocuments)
      .where(eq(tenderDocuments.tenderId, id));

    const members = await this.db
      .select({
        id: tenderTeamMembers.id,
        userId: tenderTeamMembers.userId,
        userName: users.name,
        userEmail: users.email,
        createdAt: tenderTeamMembers.createdAt,
      })
      .from(tenderTeamMembers)
      .leftJoin(users, eq(users.id, tenderTeamMembers.userId))
      .where(eq(tenderTeamMembers.tenderId, id));

    return { ...tender, requirements, documents: docs, teamMembers: members };
  }

  async create(dto: CreateTenderDto, userId: string) {
    if (!dto.name?.trim()) {
      throw new BadRequestException('Tender name is required');
    }

    let code = dto.code?.trim() || '';
    if (!code) {
      const year = new Date().getFullYear();
      const [{ count }] = await this.db
        .select({ count: sql<number>`count(*)` })
        .from(tenders);
      code = `TND-${year}-${String(Number(count) + 1).padStart(3, '0')}`;
    }

    const [tender] = await this.db
      .insert(tenders)
      .values({
        code,
        name: dto.name.trim(),
        organization: dto.organization?.trim() || null,
        description: dto.description?.trim() || null,
        category: dto.category?.trim() || null,
        deadline: dto.deadline ? new Date(dto.deadline) : null,
        value: dto.value?.trim() || null,
        status: 'Active',
        ownerId: userId,
      })
      .returning();

    if (dto.requirements?.length) {
      await this.db.insert(tenderRequirements).values(
        dto.requirements.map((r, i) => ({
          tenderId: tender.id,
          code: `REQ-${String(i + 1).padStart(3, '0')}`,
          title: r.title,
          priority: r.priority || 'Medium',
          status: 'gap' as const,
        })),
      );
    }

    if (dto.teamMemberIds?.length) {
      const validIds = dto.teamMemberIds.filter((uid) =>
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
          uid,
        ),
      );
      if (validIds.length > 0) {
        await this.db.insert(tenderTeamMembers).values(
          validIds.map((uid) => ({
            tenderId: tender.id,
            userId: uid,
          })),
        );
      }
    }

    return tender;
  }

  async update(id: string, dto: UpdateTenderDto) {
    const [updated] = await this.db
      .update(tenders)
      .set({
        ...dto,
        deadline: dto.deadline ? new Date(dto.deadline) : undefined,
        updatedAt: new Date(),
      })
      .where(eq(tenders.id, id))
      .returning();

    if (!updated) throw new NotFoundException('Tender not found');
    return updated;
  }

  async remove(id: string, userId: string) {
    const [tender] = await this.db
      .select()
      .from(tenders)
      .where(eq(tenders.id, id));

    if (!tender) throw new NotFoundException('Tender not found');
    if (tender.ownerId !== userId) {
      throw new ForbiddenException('Only the tender owner can delete it');
    }

    await this.db.delete(tenders).where(eq(tenders.id, id));
  }
}
