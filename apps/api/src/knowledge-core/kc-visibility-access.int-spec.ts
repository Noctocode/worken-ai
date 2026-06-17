import {
  companies,
  knowledgeChunks,
  knowledgeFileTeams,
  knowledgeFiles,
  knowledgeFolders,
  projectKnowledgeFiles,
  projects,
  teamMembers,
  teams,
  users,
} from '@worken/database/schema';
import { KnowledgeIngestionService } from './knowledge-ingestion.service.js';
import { startTestDb, type TestDb } from '../test-integration/db-harness.js';

/**
 * Integration coverage for the chat-time RAG ACCESS gating — the security-
 * critical part of Knowledge Core that decides which chunks a caller may see.
 * These run the real `searchAccessibleChunks` / `searchProjectAttachedChunks`
 * SQL against a real pgvector DB, which mocks can't exercise.
 *
 * The query embedding is stubbed to a constant vector (access, not ranking,
 * is what we assert); every seeded chunk shares it, and we call with a high
 * limit so the `ORDER BY similarity LIMIT n` never hides an accessible row.
 */
const DIM = 384;
const VEC = Array.from({ length: DIM }, () => 0.1);

describe('KnowledgeCore RAG access (integration)', () => {
  let t: TestDb;
  let svc: KnowledgeIngestionService;
  let seq = 0;

  beforeAll(async () => {
    t = await startTestDb();
    const docsStub = { embed: () => Promise.resolve([VEC]) };
    svc = new KnowledgeIngestionService(
      t.db,
      docsStub as never,
      {} as never,
      null as never,
      null as never,
      null as never,
      null as never,
    );
  });

  afterAll(async () => {
    await t?.stop();
  });

  // ── seed helpers ───────────────────────────────────────────────────
  const uid = () => `seed-${++seq}`;

  async function mkCompany(): Promise<string> {
    const [r] = await t.db
      .insert(companies)
      .values({ name: `co-${uid()}` })
      .returning({ id: companies.id });
    return r.id;
  }
  async function mkUser(opts: {
    role?: 'admin' | 'basic';
    companyId?: string | null;
  }): Promise<string> {
    const [r] = await t.db
      .insert(users)
      .values({
        email: `u-${uid()}@test.local`,
        role: opts.role ?? 'basic',
        companyId: opts.companyId ?? null,
      })
      .returning({ id: users.id });
    return r.id;
  }
  async function mkTeam(ownerId: string): Promise<string> {
    const [r] = await t.db
      .insert(teams)
      .values({ name: `team-${uid()}`, ownerId })
      .returning({ id: teams.id });
    return r.id;
  }
  async function addMember(
    teamId: string,
    userId: string,
    status: 'accepted' | 'pending' = 'accepted',
  ): Promise<void> {
    await t.db.insert(teamMembers).values({
      teamId,
      userId,
      email: `m-${uid()}@test.local`,
      role: 'viewer',
      status,
    });
  }
  async function mkProject(userId: string, teamId?: string): Promise<string> {
    const [r] = await t.db
      .insert(projects)
      .values({ userId, name: `proj-${uid()}`, model: 'm', teamId })
      .returning({ id: projects.id });
    return r.id;
  }
  async function mkFolder(ownerId: string): Promise<string> {
    const [r] = await t.db
      .insert(knowledgeFolders)
      .values({ name: `f-${uid()}`, ownerId })
      .returning({ id: knowledgeFolders.id });
    return r.id;
  }
  /** Create a file + one chunk (same scope/visibility) and return the id. */
  async function mkFile(opts: {
    folderId: string;
    uploadedById: string;
    scope: 'personal' | 'company';
    visibility: string;
  }): Promise<string> {
    const [file] = await t.db
      .insert(knowledgeFiles)
      .values({
        folderId: opts.folderId,
        name: `file-${uid()}`,
        uploadedById: opts.uploadedById,
        scope: opts.scope,
        visibility: opts.visibility,
        ingestionStatus: 'done',
      })
      .returning({ id: knowledgeFiles.id });
    await t.db.insert(knowledgeChunks).values({
      userId: opts.uploadedById,
      fileId: file.id,
      chunkIndex: 0,
      content: `content ${uid()}`,
      embedding: VEC,
      scope: opts.scope,
      visibility: opts.visibility,
    });
    return file.id;
  }
  const linkTeam = (fileId: string, teamId: string) =>
    t.db.insert(knowledgeFileTeams).values({ fileId, teamId });
  const linkProject = (projectId: string, fileId: string, by: string) =>
    t.db.insert(projectKnowledgeFiles).values({
      projectId,
      fileId,
      attachedBy: by,
    });

  const broadIds = async (userId: string): Promise<string[]> =>
    (await svc.searchAccessibleChunks(userId, 'q', 50)).map((r) => r.fileId);

  // ── broad RAG (searchAccessibleChunks) ─────────────────────────────
  describe('searchAccessibleChunks', () => {
    it('personal-scope file is visible only to its owner', async () => {
      const co = await mkCompany();
      const owner = await mkUser({ companyId: co });
      const other = await mkUser({ companyId: co });
      const folder = await mkFolder(owner);
      const file = await mkFile({
        folderId: folder,
        uploadedById: owner,
        scope: 'personal',
        visibility: 'all',
      });
      expect(await broadIds(owner)).toContain(file);
      expect(await broadIds(other)).not.toContain(file);
    });

    it("company visibility='all' is visible across the same company but not other tenants", async () => {
      const coA = await mkCompany();
      const coB = await mkCompany();
      const uploader = await mkUser({ companyId: coA });
      const sameCo = await mkUser({ companyId: coA });
      const otherCo = await mkUser({ companyId: coB });
      const folder = await mkFolder(uploader);
      const file = await mkFile({
        folderId: folder,
        uploadedById: uploader,
        scope: 'company',
        visibility: 'all',
      });
      expect(await broadIds(sameCo)).toContain(file);
      expect(await broadIds(otherCo)).not.toContain(file); // tenant isolation
    });

    it("company visibility='admins' is admin-only", async () => {
      const co = await mkCompany();
      const uploader = await mkUser({ companyId: co });
      const admin = await mkUser({ role: 'admin', companyId: co });
      const basic = await mkUser({ companyId: co });
      const folder = await mkFolder(uploader);
      const file = await mkFile({
        folderId: folder,
        uploadedById: uploader,
        scope: 'company',
        visibility: 'admins',
      });
      expect(await broadIds(admin)).toContain(file);
      expect(await broadIds(basic)).not.toContain(file);
    });

    it("company visibility='teams' needs accepted membership", async () => {
      const co = await mkCompany();
      const uploader = await mkUser({ companyId: co });
      const member = await mkUser({ companyId: co });
      const nonMember = await mkUser({ companyId: co });
      const team = await mkTeam(uploader);
      await addMember(team, member, 'accepted');
      const folder = await mkFolder(uploader);
      const file = await mkFile({
        folderId: folder,
        uploadedById: uploader,
        scope: 'company',
        visibility: 'teams',
      });
      await linkTeam(file, team);
      expect(await broadIds(member)).toContain(file);
      expect(await broadIds(nonMember)).not.toContain(file);
    });

    it("company visibility='project' never surfaces in the broad path", async () => {
      const co = await mkCompany();
      const uploader = await mkUser({ companyId: co });
      const admin = await mkUser({ role: 'admin', companyId: co });
      const folder = await mkFolder(uploader);
      const project = await mkProject(uploader);
      const file = await mkFile({
        folderId: folder,
        uploadedById: uploader,
        scope: 'company',
        visibility: 'project',
      });
      await linkProject(project, file, uploader);
      // Excluded from broad RAG even for an admin — reachable only inside
      // the project chat (searchProjectAttachedChunks).
      expect(await broadIds(admin)).not.toContain(file);
    });
  });

  // ── project chat (searchProjectAttachedChunks) ─────────────────────
  describe('searchProjectAttachedChunks', () => {
    it('surfaces a project-attached file inside the project for a company member', async () => {
      const co = await mkCompany();
      const uploader = await mkUser({ companyId: co });
      const viewer = await mkUser({ companyId: co });
      const folder = await mkFolder(uploader);
      const project = await mkProject(uploader);
      const file = await mkFile({
        folderId: folder,
        uploadedById: uploader,
        scope: 'company',
        visibility: 'project',
      });
      await linkProject(project, file, uploader);
      const got = await svc.searchProjectAttachedChunks(
        viewer,
        [file],
        'q',
        50,
      );
      expect(got.map((r) => r.fileId)).toContain(file);
    });

    it('keeps an admin-only file off-limits to a non-admin even when project-attached', async () => {
      const co = await mkCompany();
      const uploader = await mkUser({ companyId: co });
      const basic = await mkUser({ companyId: co });
      const folder = await mkFolder(uploader);
      const project = await mkProject(uploader);
      const file = await mkFile({
        folderId: folder,
        uploadedById: uploader,
        scope: 'company',
        visibility: 'admins',
      });
      await linkProject(project, file, uploader);
      const got = await svc.searchProjectAttachedChunks(basic, [file], 'q', 50);
      expect(got.map((r) => r.fileId)).not.toContain(file);
    });
  });
});
