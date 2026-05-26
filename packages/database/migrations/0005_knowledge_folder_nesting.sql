-- Nested folders in Knowledge Core.
--
-- Until now `knowledge_folders` was a single flat list per user.
-- Adds an optional `parent_folder_id` so a folder can live inside
-- another folder; NULL = top-level (the only state pre-migration).
-- Used by Drive import to put "Google Drive > Test" / "Google Drive
-- > ProjectX" so imports from many Drive folders don't pile into a
-- single mixed bag, plus by the FE so users can create their own
-- nested structure.
--
-- Cascade on delete keeps subtree cleanup automatic: deleting a
-- parent folder removes every descendant folder and (via the
-- existing FK on knowledge_files.folder_id) every file in those
-- folders. Index on parent_folder_id makes the "list children of
-- folder X" query a single index probe; without it, the FE folder
-- detail page would full-scan knowledge_folders on every navigation.
--
-- Safe additive change — existing rows get parent_folder_id=NULL and
-- behave exactly as before (top-level folders).

ALTER TABLE "knowledge_folders" ADD COLUMN "parent_folder_id" uuid;--> statement-breakpoint
ALTER TABLE "knowledge_folders" ADD CONSTRAINT "knowledge_folders_parent_folder_id_knowledge_folders_id_fk" FOREIGN KEY ("parent_folder_id") REFERENCES "public"."knowledge_folders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "knowledge_folders_parent_idx" ON "knowledge_folders" USING btree ("parent_folder_id");
