CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX IF NOT EXISTS vault_document_title_trgm ON "VaultDocument" USING gin (title gin_trgm_ops);
CREATE INDEX IF NOT EXISTS vault_document_markdown_trgm ON "VaultDocument" USING gin (markdown gin_trgm_ops);
