import {
  companies,
  projects,
  skillProjects,
  skillTeams,
  skills,
  teamMembers,
  teams,
  users,
} from '@worken/database/schema';
import { SkillRouterService } from './skill-router.service.js';
import { startTestDb, type TestDb } from '../test-integration/db-harness.js';

/**
 * Integration coverage for SKILL visibility scoping — team-restricted and
 * project-restricted skills — against a real DB. Exercises the actual
 * `SkillRouterService.getAccessibleSkills` SQL (the gate that decides which
 * skills the router may even consider for a chat), which mocks can't.
 *
 * Only `db` is touched by getAccessibleSkills, so the embed / chat-transport
 * deps are stubs. Seeded skills carry a constant 384-dim description embedding
 * (the query requires a non-null embedding to route).
 */
const DIM = 384;
const VEC = Array.from({ length: DIM }, () => 0.1);

describe('Skill visibility — team & project scoping (integration)', () => {
  let t: TestDb;
  let router: SkillRouterService;
  let seq = 0;

  beforeAll(async () => {
    t = await startTestDb();
    router = new SkillRouterService(t.db, {} as never, {} as never);
  });

  afterAll(async () => {
    await t?.stop();
  });

  const uid = () => `s-${++seq}`;

  async function mkCompany(): Promise<string> {
    const [r] = await t.db
      .insert(companies)
      .values({ name: `co-${uid()}` })
      .returning({ id: companies.id });
    return r.id;
  }
  async function mkUser(
    companyId: string | null,
    role: 'admin' | 'basic' = 'basic',
  ) {
    const [r] = await t.db
      .insert(users)
      .values({ email: `u-${uid()}@t.local`, role, companyId })
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
  async function addMember(teamId: string, userId: string): Promise<void> {
    await t.db.insert(teamMembers).values({
      teamId,
      userId,
      email: `m-${uid()}@t.local`,
      role: 'viewer',
      status: 'accepted',
    });
  }
  async function mkProject(userId: string): Promise<string> {
    const [r] = await t.db
      .insert(projects)
      .values({ userId, name: `proj-${uid()}`, model: 'm' })
      .returning({ id: projects.id });
    return r.id;
  }
  /** Seed a routable (active, embedded) skill. */
  async function mkSkill(opts: {
    userId: string;
    scope: 'personal' | 'company';
    visibility: 'all' | 'admins' | 'teams' | 'project';
  }): Promise<string> {
    const [r] = await t.db
      .insert(skills)
      .values({
        userId: opts.userId,
        name: `skill-${uid()}`,
        description: 'desc',
        instructions: 'do the thing',
        scope: opts.scope,
        visibility: opts.visibility,
        descriptionEmbedding: VEC,
      })
      .returning({ id: skills.id });
    return r.id;
  }
  const linkTeam = (skillId: string, teamId: string) =>
    t.db.insert(skillTeams).values({ skillId, teamId });
  const linkProject = (skillId: string, projectId: string) =>
    t.db.insert(skillProjects).values({ skillId, projectId });

  const accessibleIds = async (
    userId: string,
    projectId?: string | null,
  ): Promise<string[]> =>
    (await router.getAccessibleSkills(userId, projectId)).map((s) => s.id);

  // ── Team-scoped visibility ─────────────────────────────────────────
  describe("visibility='teams'", () => {
    it('is routable for an accepted member but not for a non-member', async () => {
      const co = await mkCompany();
      const owner = await mkUser(co);
      const member = await mkUser(co);
      const nonMember = await mkUser(co);
      const team = await mkTeam(owner);
      await addMember(team, member);

      const skill = await mkSkill({
        userId: owner,
        scope: 'company',
        visibility: 'teams',
      });
      await linkTeam(skill, team);

      expect(await accessibleIds(member)).toContain(skill);
      expect(await accessibleIds(nonMember)).not.toContain(skill);
    });

    // Regression: a team-scoped skill the user OWNS must still obey the team
    // gate — the owner does not get a free pass into every chat just because
    // they created it. (Bug: owner saw their 'teams' skill in all projects.)
    it('does NOT route for the owner when they are not a member of the team', async () => {
      const co = await mkCompany();
      const owner = await mkUser(co);
      const team = await mkTeam(owner); // team.ownerId set, but no membership row
      const skill = await mkSkill({
        userId: owner,
        scope: 'company',
        visibility: 'teams',
      });
      await linkTeam(skill, team);
      expect(await accessibleIds(owner)).not.toContain(skill);
    });

    it('routes for the owner once they are an accepted member', async () => {
      const co = await mkCompany();
      const owner = await mkUser(co);
      const team = await mkTeam(owner);
      await addMember(team, owner);
      const skill = await mkSkill({
        userId: owner,
        scope: 'company',
        visibility: 'teams',
      });
      await linkTeam(skill, team);
      expect(await accessibleIds(owner)).toContain(skill);
    });

    it('does not leak to another tenant even for a team-shaped query', async () => {
      const coA = await mkCompany();
      const coB = await mkCompany();
      const owner = await mkUser(coA);
      const team = await mkTeam(owner);
      const outsider = await mkUser(coB);
      await addMember(team, outsider); // cross-tenant membership row
      const skill = await mkSkill({
        userId: owner,
        scope: 'company',
        visibility: 'teams',
      });
      await linkTeam(skill, team);
      // sameCompany gate blocks it — outsider's company != skill owner's.
      expect(await accessibleIds(outsider)).not.toContain(skill);
    });
  });

  // ── Project-scoped visibility ──────────────────────────────────────
  describe("visibility='project'", () => {
    it('routes ONLY inside its linked project', async () => {
      const co = await mkCompany();
      const owner = await mkUser(co);
      const viewer = await mkUser(co);
      const project = await mkProject(owner);
      const otherProject = await mkProject(owner);

      const skill = await mkSkill({
        userId: owner,
        scope: 'company',
        visibility: 'project',
      });
      await linkProject(skill, project);

      // In the linked project → visible (to any company member chatting there).
      expect(await accessibleIds(viewer, project)).toContain(skill);
      // No project context → hidden.
      expect(await accessibleIds(viewer)).not.toContain(skill);
      // A different project → hidden.
      expect(await accessibleIds(viewer, otherProject)).not.toContain(skill);
    });

    it('stays hidden from an admin outside the project, but shows inside it', async () => {
      const co = await mkCompany();
      const owner = await mkUser(co);
      const admin = await mkUser(co, 'admin');
      const project = await mkProject(owner);
      const skill = await mkSkill({
        userId: owner,
        scope: 'company',
        visibility: 'project',
      });
      await linkProject(skill, project);

      expect(await accessibleIds(admin)).not.toContain(skill); // no project ctx
      expect(await accessibleIds(admin, project)).toContain(skill);
    });

    it('the owner also only sees their own project skill inside its project', async () => {
      const co = await mkCompany();
      const owner = await mkUser(co);
      const project = await mkProject(owner);
      const skill = await mkSkill({
        userId: owner,
        scope: 'company',
        visibility: 'project',
      });
      await linkProject(skill, project);

      expect(await accessibleIds(owner)).not.toContain(skill); // outside project
      expect(await accessibleIds(owner, project)).toContain(skill);
    });
  });
});
