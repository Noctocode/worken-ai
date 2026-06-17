import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import {
  companies,
  knowledgeChunks,
  knowledgeFiles,
  knowledgeFolders,
  projectKnowledgeFiles,
  projects,
  scheduleKnowledgeFiles,
  scheduledPrompts,
  users,
} from '@worken/database/schema';
import { ScheduleKnowledgeService } from './schedule-knowledge.service.js';
import { KnowledgeIngestionService } from '../knowledge-core/knowledge-ingestion.service.js';
import { startTestDb, type TestDb } from '../test-integration/db-harness.js';

/**
 * End-to-end-ish coverage for AI Cron schedule files against a real DB:
 *   1. a file attached to a schedule is scoped to THAT schedule
 *      (visibility='schedule' + a schedule_knowledge_files link),
 *   2. it is NOT visible in the broad chat/arena RAG (searchAccessibleChunks),
 *   3. when the schedule runs, its content IS gathered as context — exactly the
 *      cron-runner path: getAttachedFileIds → searchScheduleAttachedChunks,
 *   4. another schedule does not see it (per-schedule isolation),
 *   5. the attach gate rejects non-owned files / non-owned schedules.
 *
 * The query embedding is stubbed to a constant vector (we assert which rows the
 * access/attach logic returns, not similarity ranking).
 */
const DIM = 384;
const VEC = Array.from({ length: DIM }, () => 0.1);
const FILE_TEXT = 'The Q3 revenue target is 5 million euros.';

describe('AI Cron schedule knowledge (integration)', () => {
  let t: TestDb;
  let scheduleKnowledge: ScheduleKnowledgeService;
  let ingestion: KnowledgeIngestionService;
  let seq = 0;

  beforeAll(async () => {
    t = await startTestDb();
    const docsStub = { embed: () => Promise.resolve([VEC]) };
    scheduleKnowledge = new ScheduleKnowledgeService(t.db, {} as never);
    ingestion = new KnowledgeIngestionService(
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

  const uid = () => `sk-${++seq}`;

  async function mkCompany() {
    const [r] = await t.db
      .insert(companies)
      .values({ name: `co-${uid()}` })
      .returning({ id: companies.id });
    return r.id;
  }
  async function mkUser(companyId: string | null) {
    const [r] = await t.db
      .insert(users)
      .values({ email: `u-${uid()}@t.local`, companyId })
      .returning({ id: users.id });
    return r.id;
  }
  async function mkFolder(ownerId: string) {
    const [r] = await t.db
      .insert(knowledgeFolders)
      .values({ name: 'AI Cron', ownerId })
      .returning({ id: knowledgeFolders.id });
    return r.id;
  }
  async function mkSchedule(ownerId: string) {
    const [r] = await t.db
      .insert(scheduledPrompts)
      .values({
        ownerId,
        name: `sched-${uid()}`,
        prompt: 'What is the Q3 revenue target?',
        modelIdentifier: 'claude-opus-4-8',
        cronExpression: '0 9 * * *',
      })
      .returning({ id: scheduledPrompts.id });
    return r.id;
  }
  /** A schedule-uploaded file: visibility='schedule', one chunk, owned by user. */
  async function mkScheduleFile(opts: {
    folderId: string;
    ownerId: string;
    content?: string;
  }) {
    const [file] = await t.db
      .insert(knowledgeFiles)
      .values({
        folderId: opts.folderId,
        name: `report-${uid()}.docx`,
        uploadedById: opts.ownerId,
        scope: 'company',
        visibility: 'schedule',
        ingestionStatus: 'done',
      })
      .returning({ id: knowledgeFiles.id });
    await t.db.insert(knowledgeChunks).values({
      userId: opts.ownerId,
      fileId: file.id,
      chunkIndex: 0,
      content: opts.content ?? FILE_TEXT,
      embedding: VEC,
      scope: 'company',
      visibility: 'schedule',
    });
    return file.id;
  }

  async function mkProject(ownerId: string) {
    const [r] = await t.db
      .insert(projects)
      .values({ userId: ownerId, name: `proj-${uid()}`, model: 'm' })
      .returning({ id: projects.id });
    return r.id;
  }
  /**
   * A file scoped to a specific project (UNION model: base 'none' + a
   * project_knowledge_files link), with one chunk. Mirrors what the
   * "Specific → project" picker produces in Knowledge Core.
   */
  async function mkProjectFile(opts: {
    folderId: string;
    ownerId: string;
    projectId: string;
  }) {
    const [file] = await t.db
      .insert(knowledgeFiles)
      .values({
        folderId: opts.folderId,
        name: `proj-report-${uid()}.docx`,
        uploadedById: opts.ownerId,
        scope: 'company',
        visibility: 'none',
        ingestionStatus: 'done',
      })
      .returning({ id: knowledgeFiles.id });
    await t.db.insert(knowledgeChunks).values({
      userId: opts.ownerId,
      fileId: file.id,
      chunkIndex: 0,
      content: FILE_TEXT,
      embedding: VEC,
      scope: 'company',
      visibility: 'none',
    });
    await t.db.insert(projectKnowledgeFiles).values({
      projectId: opts.projectId,
      fileId: file.id,
      attachedBy: opts.ownerId,
    });
    return file.id;
  }

  // Mirrors CronRunnerService: resolve the schedule's attached files, then pull
  // their chunks for the prompt — the context the model actually receives.
  async function gatherScheduleContext(scheduleId: string, ownerId: string) {
    const fileIds = await scheduleKnowledge.getAttachedFileIds(scheduleId);
    const chunks = await ingestion.searchScheduleAttachedChunks(
      ownerId,
      fileIds,
      'What is the Q3 revenue target?',
    );
    return chunks.map((c) => c.content);
  }

  it('attaches a file to a schedule and scopes it to that schedule', async () => {
    const co = await mkCompany();
    const owner = await mkUser(co);
    const folder = await mkFolder(owner);
    const schedule = await mkSchedule(owner);
    const file = await mkScheduleFile({ folderId: folder, ownerId: owner });

    const { attached } = await scheduleKnowledge.attach(
      schedule,
      [file],
      owner,
    );
    expect(attached).toEqual([file]);
    expect(await scheduleKnowledge.getAttachedFileIds(schedule)).toEqual([
      file,
    ]);

    // The file row carries visibility='schedule' — i.e. KC shows it scoped to
    // the schedule, not "Everyone".
    const [row] = await t.db
      .select({ visibility: knowledgeFiles.visibility })
      .from(knowledgeFiles)
      .where(eq(knowledgeFiles.id, file));
    expect(row.visibility).toBe('schedule');
  });

  it('includes the file content when the schedule runs (cron-runner path)', async () => {
    const co = await mkCompany();
    const owner = await mkUser(co);
    const folder = await mkFolder(owner);
    const schedule = await mkSchedule(owner);
    const file = await mkScheduleFile({ folderId: folder, ownerId: owner });
    await scheduleKnowledge.attach(schedule, [file], owner);

    const context = await gatherScheduleContext(schedule, owner);
    expect(context).toContain(FILE_TEXT);
  });

  it('does NOT surface the schedule file in the broad chat/arena RAG', async () => {
    const co = await mkCompany();
    const owner = await mkUser(co);
    const folder = await mkFolder(owner);
    const schedule = await mkSchedule(owner);
    const file = await mkScheduleFile({ folderId: folder, ownerId: owner });
    await scheduleKnowledge.attach(schedule, [file], owner);

    const broad = await ingestion.searchAccessibleChunks(owner, 'revenue', 50);
    expect(broad.map((r) => r.fileId)).not.toContain(file);
  });

  it('keeps schedule files isolated to their own schedule', async () => {
    const co = await mkCompany();
    const owner = await mkUser(co);
    const folder = await mkFolder(owner);
    const scheduleA = await mkSchedule(owner);
    const scheduleB = await mkSchedule(owner);
    const file = await mkScheduleFile({ folderId: folder, ownerId: owner });
    await scheduleKnowledge.attach(scheduleA, [file], owner);

    // B has no files → its run gathers no content from A's file.
    expect(await scheduleKnowledge.getAttachedFileIds(scheduleB)).toEqual([]);
    expect(await gatherScheduleContext(scheduleB, owner)).toEqual([]);
  });

  // The scenario from the report: a file already scoped to a specific project
  // in Knowledge Core, then attached to a schedule. It must end up with BOTH
  // scopes at once (UNION) — the project link is preserved, a schedule link is
  // added — and surface in BOTH the project chat and the schedule run.
  it('keeps project scope AND gains schedule scope when a project file is attached', async () => {
    const co = await mkCompany();
    const owner = await mkUser(co);
    const folder = await mkFolder(owner);
    const project = await mkProject(owner);
    const schedule = await mkSchedule(owner);
    const file = await mkProjectFile({
      folderId: folder,
      ownerId: owner,
      projectId: project,
    });

    await scheduleKnowledge.attach(schedule, [file], owner);

    // BOTH link rows coexist — KC will show the file scoped to the project AND
    // the schedule (not one replacing the other).
    const projectLinks = await t.db
      .select({ fileId: projectKnowledgeFiles.fileId })
      .from(projectKnowledgeFiles)
      .where(eq(projectKnowledgeFiles.fileId, file));
    const scheduleLinks = await t.db
      .select({ fileId: scheduleKnowledgeFiles.fileId })
      .from(scheduleKnowledgeFiles)
      .where(eq(scheduleKnowledgeFiles.fileId, file));
    expect(projectLinks).toHaveLength(1);
    expect(scheduleLinks).toHaveLength(1);

    // Project chat still surfaces it (project scope intact)…
    const projectChunks = await ingestion.searchProjectAttachedChunks(
      owner,
      [file],
      'revenue',
      50,
    );
    expect(projectChunks.map((c) => c.fileId)).toContain(file);

    // …and the schedule run gathers it too (schedule scope added).
    expect(await gatherScheduleContext(schedule, owner)).toContain(FILE_TEXT);

    // Still hidden from the broad chat/arena RAG.
    const broad = await ingestion.searchAccessibleChunks(owner, 'revenue', 50);
    expect(broad.map((r) => r.fileId)).not.toContain(file);
  });

  // Two schedules ask the same question ("what is noctomarmelada made of?").
  // Only schedule A has the file that holds the answer ("…iz hrušk"). The test
  // asserts the DETERMINISTIC core that drives the notifications: A's prompt
  // context carries the answer, B's does not — so A's model can say "pears" and
  // B's can't. (The actual LLM-written notification text is non-deterministic
  // and needs a live model, so it's out of scope for an automated test.)
  it("only the schedule holding the file gets the answer ('iz hrušk') in context", async () => {
    const co = await mkCompany();
    const owner = await mkUser(co);
    const folder = await mkFolder(owner);
    const scheduleWithFile = await mkSchedule(owner);
    const scheduleWithoutFile = await mkSchedule(owner);

    const file = await mkScheduleFile({
      folderId: folder,
      ownerId: owner,
      content: 'Noctomarmelada je narejena iz hrušk.',
    });
    await scheduleKnowledge.attach(scheduleWithFile, [file], owner);

    const ctxWith = (await gatherScheduleContext(scheduleWithFile, owner)).join(
      ' ',
    );
    const ctxWithout = await gatherScheduleContext(scheduleWithoutFile, owner);

    // Schedule A: the model receives the fact, so its notification can say pears.
    expect(ctxWith).toContain('hrušk');
    // Schedule B: no file attached → no such fact in context, can't know.
    expect(ctxWithout).toEqual([]);
  });

  it('rejects attaching a file the caller does not own', async () => {
    const co = await mkCompany();
    const owner = await mkUser(co);
    const other = await mkUser(co);
    const folder = await mkFolder(other);
    const schedule = await mkSchedule(owner);
    const othersFile = await mkScheduleFile({
      folderId: folder,
      ownerId: other,
    });

    await expect(
      scheduleKnowledge.attach(schedule, [othersFile], owner),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('rejects attaching to a schedule the caller does not own', async () => {
    const co = await mkCompany();
    const owner = await mkUser(co);
    const intruder = await mkUser(co);
    const folder = await mkFolder(intruder);
    const schedule = await mkSchedule(owner);
    const intrudersFile = await mkScheduleFile({
      folderId: folder,
      ownerId: intruder,
    });

    await expect(
      scheduleKnowledge.attach(schedule, [intrudersFile], intruder),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
