import {
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { eq, desc, sql } from 'drizzle-orm';
import {
  knowledgeFolders,
  knowledgeFiles,
  users,
} from '@worken/database/schema';
import { DATABASE, type Database } from '../database/database.module.js';
import * as fs from 'node:fs';
import * as path from 'node:path';

const UPLOAD_BASE = path.join(process.cwd(), 'uploads', 'knowledge-core');

@Injectable()
export class KnowledgeCoreService {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async findAllFolders(userId: string) {
    const rows = await this.db
      .select({
        id: knowledgeFolders.id,
        name: knowledgeFolders.name,
        ownerId: knowledgeFolders.ownerId,
        createdAt: knowledgeFolders.createdAt,
        updatedAt: knowledgeFolders.updatedAt,
        fileCount: sql<string>`count(${knowledgeFiles.id})`.as('file_count'),
        totalBytes: sql<string>`coalesce(sum(${knowledgeFiles.sizeBytes}), 0)`.as(
          'total_bytes',
        ),
      })
      .from(knowledgeFolders)
      .leftJoin(
        knowledgeFiles,
        eq(knowledgeFiles.folderId, knowledgeFolders.id),
      )
      .where(eq(knowledgeFolders.ownerId, userId))
      .groupBy(
        knowledgeFolders.id,
        knowledgeFolders.name,
        knowledgeFolders.ownerId,
        knowledgeFolders.createdAt,
        knowledgeFolders.updatedAt,
      )
      .orderBy(desc(knowledgeFolders.updatedAt));

    return rows.map((r) => ({
      ...r,
      fileCount: Number(r.fileCount),
      totalBytes: Number(r.totalBytes),
    }));
  }

  async findFolder(id: string, userId: string) {
    const [folder] = await this.db
      .select()
      .from(knowledgeFolders)
      .where(eq(knowledgeFolders.id, id));

    if (!folder) throw new NotFoundException('Folder not found');
    if (folder.ownerId !== userId) throw new ForbiddenException('Access denied');

    const files = await this.db
      .select({
        id: knowledgeFiles.id,
        folderId: knowledgeFiles.folderId,
        name: knowledgeFiles.name,
        fileType: knowledgeFiles.fileType,
        sizeBytes: knowledgeFiles.sizeBytes,
        storagePath: knowledgeFiles.storagePath,
        uploadedById: knowledgeFiles.uploadedById,
        uploadedByName: users.name,
        createdAt: knowledgeFiles.createdAt,
      })
      .from(knowledgeFiles)
      .leftJoin(users, eq(users.id, knowledgeFiles.uploadedById))
      .where(eq(knowledgeFiles.folderId, id))
      .orderBy(desc(knowledgeFiles.createdAt));

    return { ...folder, files };
  }

  async createFolder(name: string, userId: string) {
    const [folder] = await this.db
      .insert(knowledgeFolders)
      .values({ name: name.trim(), ownerId: userId })
      .returning();
    return folder;
  }

  async deleteFolder(id: string, userId: string) {
    const [folder] = await this.db
      .select()
      .from(knowledgeFolders)
      .where(eq(knowledgeFolders.id, id));

    if (!folder) throw new NotFoundException('Folder not found');
    if (folder.ownerId !== userId) throw new ForbiddenException('Access denied');

    await this.db.delete(knowledgeFolders).where(eq(knowledgeFolders.id, id));
  }

  async uploadFiles(
    folderId: string,
    userId: string,
    files: Express.Multer.File[],
  ) {
    const [folder] = await this.db
      .select()
      .from(knowledgeFolders)
      .where(eq(knowledgeFolders.id, folderId));

    if (!folder) throw new NotFoundException('Folder not found');
    if (folder.ownerId !== userId) throw new ForbiddenException('Access denied');

    const inserted: (typeof knowledgeFiles.$inferSelect)[] = [];
    for (const file of files) {
      const ext = path.extname(file.originalname).replace('.', '').toUpperCase();
      const fileType =
        ext === 'DOC' ? 'DOCX' : ext === 'XLS' ? 'XLSX' : ext || 'FILE';

      const [row] = await this.db
        .insert(knowledgeFiles)
        .values({
          folderId,
          name: file.originalname,
          fileType,
          sizeBytes: file.size,
          storagePath: path.posix.join(
            'uploads/knowledge-core',
            path.basename(file.path),
          ),
          uploadedById: userId,
        })
        .returning();
      inserted.push(row);
    }

    await this.db
      .update(knowledgeFolders)
      .set({ updatedAt: new Date() })
      .where(eq(knowledgeFolders.id, folderId));

    return inserted;
  }

  async getFileForDownload(fileId: string, userId: string) {
    const [file] = await this.db
      .select({
        id: knowledgeFiles.id,
        name: knowledgeFiles.name,
        storagePath: knowledgeFiles.storagePath,
        ownerId: knowledgeFolders.ownerId,
      })
      .from(knowledgeFiles)
      .innerJoin(
        knowledgeFolders,
        eq(knowledgeFolders.id, knowledgeFiles.folderId),
      )
      .where(eq(knowledgeFiles.id, fileId));

    if (!file) throw new NotFoundException('File not found');
    if (file.ownerId !== userId) throw new ForbiddenException('Access denied');
    if (!file.storagePath) throw new NotFoundException('File not on disk');

    return {
      name: file.name,
      storagePath: path.resolve(process.cwd(), file.storagePath),
    };
  }

  async moveFile(fileId: string, targetFolderId: string, userId: string) {
    const [file] = await this.db
      .select({
        id: knowledgeFiles.id,
        folderId: knowledgeFiles.folderId,
        ownerId: knowledgeFolders.ownerId,
      })
      .from(knowledgeFiles)
      .innerJoin(
        knowledgeFolders,
        eq(knowledgeFolders.id, knowledgeFiles.folderId),
      )
      .where(eq(knowledgeFiles.id, fileId));

    if (!file) throw new NotFoundException('File not found');
    if (file.ownerId !== userId) throw new ForbiddenException('Access denied');

    const [targetFolder] = await this.db
      .select()
      .from(knowledgeFolders)
      .where(eq(knowledgeFolders.id, targetFolderId));

    if (!targetFolder) throw new NotFoundException('Target folder not found');
    if (targetFolder.ownerId !== userId)
      throw new ForbiddenException('Access denied');

    await this.db
      .update(knowledgeFiles)
      .set({ folderId: targetFolderId })
      .where(eq(knowledgeFiles.id, fileId));

    await this.db
      .update(knowledgeFolders)
      .set({ updatedAt: new Date() })
      .where(eq(knowledgeFolders.id, targetFolderId));

    await this.db
      .update(knowledgeFolders)
      .set({ updatedAt: new Date() })
      .where(eq(knowledgeFolders.id, file.folderId));
  }

  async deleteFile(fileId: string, userId: string) {
    const [file] = await this.db
      .select({
        id: knowledgeFiles.id,
        storagePath: knowledgeFiles.storagePath,
        folderId: knowledgeFiles.folderId,
        ownerId: knowledgeFolders.ownerId,
      })
      .from(knowledgeFiles)
      .innerJoin(
        knowledgeFolders,
        eq(knowledgeFolders.id, knowledgeFiles.folderId),
      )
      .where(eq(knowledgeFiles.id, fileId));

    if (!file) throw new NotFoundException('File not found');
    if (file.ownerId !== userId) throw new ForbiddenException('Access denied');

    if (file.storagePath) {
      try {
        fs.unlinkSync(path.resolve(process.cwd(), file.storagePath));
      } catch {
        // File may already be removed from disk
      }
    }

    await this.db.delete(knowledgeFiles).where(eq(knowledgeFiles.id, fileId));
  }

  async recentFiles(userId: string) {
    const rows = await this.db
      .select({
        id: knowledgeFiles.id,
        name: knowledgeFiles.name,
        fileType: knowledgeFiles.fileType,
        sizeBytes: knowledgeFiles.sizeBytes,
        folderName: knowledgeFolders.name,
        uploadedByName: users.name,
        createdAt: knowledgeFiles.createdAt,
      })
      .from(knowledgeFiles)
      .innerJoin(
        knowledgeFolders,
        eq(knowledgeFolders.id, knowledgeFiles.folderId),
      )
      .leftJoin(users, eq(users.id, knowledgeFiles.uploadedById))
      .where(eq(knowledgeFolders.ownerId, userId))
      .orderBy(desc(knowledgeFiles.createdAt))
      .limit(10);

    return rows;
  }
}
