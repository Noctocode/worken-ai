# WorkenAI

AI development platform for managing workflows, comparing models, and analyzing documents.

## Project Structure

- `apps/web` - Next.js frontend (App Router)
- `apps/api` - NestJS backend
- `packages/database` - Drizzle ORM schema and migrations

## Commands

```bash
pnpm install        # Install dependencies
pnpm dev:web        # Run web app in development
pnpm dev:api        # Run API in development
pnpm build          # Build all apps
pnpm lint           # Run linter

# Database
pnpm db:start       # Start PostgreSQL with Docker
pnpm db:stop        # Stop PostgreSQL
pnpm db:generate    # Generate migrations from schema
pnpm db:migrate     # Run migrations
pnpm db:push        # Push schema directly (dev only)
pnpm db:studio      # Open Drizzle Studio
```

## Database

- PostgreSQL 16 with pgvector extension
- Drizzle ORM for type-safe queries
- Connection: `postgresql://worken:worken@localhost:5432/worken`

Schema is defined in `packages/database/src/schema/index.ts`. After changing schema:
1. Run `pnpm db:generate` to create migration files
2. Run `pnpm db:migrate` to apply them

## Conventions

- Use TypeScript for all code
- Components in `src/components/`
  - `ui/` - Reusable UI primitives (shadcn/ui)
  - `layout/` - Layout components (Sidebar, Appbar, Footer)
- Styles with Tailwind CSS
- Theme constants in `src/lib/theme.ts`

## Tech Stack

- Next.js 14+ (App Router)
- NestJS (API)
- PostgreSQL + pgvector
- Drizzle ORM
- React 18+
- Tailwind CSS
- shadcn/ui components
- pnpm (package manager)
