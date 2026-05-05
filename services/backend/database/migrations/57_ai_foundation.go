package migrations

import (
	"context"
	"fmt"

	"github.com/uptrace/bun"
)

func init() {
	Migrations.MustRegister(func(ctx context.Context, db *bun.DB) error {
		if _, err := db.NewRaw(`
			CREATE TABLE IF NOT EXISTS ai_provider_settings (
				provider_key TEXT PRIMARY KEY,
				provider_type TEXT NOT NULL DEFAULT 'openai-compatible',
				label TEXT NOT NULL DEFAULT '',
				base_url TEXT NOT NULL DEFAULT '',
				api_path TEXT NOT NULL DEFAULT '',
				api_version TEXT NOT NULL DEFAULT '',
				region TEXT NOT NULL DEFAULT '',
				organization TEXT NOT NULL DEFAULT '',
				chat_model TEXT NOT NULL DEFAULT '',
				embedding_model TEXT NOT NULL DEFAULT '',
				encrypted_token TEXT NOT NULL DEFAULT '',
				token_nonce TEXT NOT NULL DEFAULT '',
				token_key_version TEXT NOT NULL DEFAULT 'v1',
				token_configured BOOLEAN NOT NULL DEFAULT false,
				enabled BOOLEAN NOT NULL DEFAULT true,
				is_default BOOLEAN NOT NULL DEFAULT false,
				timeout_seconds INT NOT NULL DEFAULT 30,
				max_context_tokens INT NOT NULL DEFAULT 6000,
				max_output_tokens INT NOT NULL DEFAULT 1200,
				temperature DOUBLE PRECISION NOT NULL DEFAULT 0.2,
				created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
				updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
			)
		`).Exec(ctx); err != nil {
			return fmt.Errorf("migration 57 (ai_provider_settings): %w", err)
		}

		if _, err := db.NewRaw(`
			CREATE TABLE IF NOT EXISTS ai_conversations (
				id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
				user_id UUID,
				owner_user_id UUID,
				owner_org_id UUID,
				title TEXT NOT NULL DEFAULT '',
				scope_type TEXT NOT NULL DEFAULT '',
				scope_ref TEXT NOT NULL DEFAULT '',
				created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
				updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
			)
		`).Exec(ctx); err != nil {
			return fmt.Errorf("migration 57 (ai_conversations): %w", err)
		}

		if _, err := db.NewRaw(`
			CREATE TABLE IF NOT EXISTS ai_messages (
				id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
				conversation_id UUID NOT NULL REFERENCES ai_conversations(id) ON DELETE CASCADE,
				role TEXT NOT NULL,
				content TEXT NOT NULL,
				provider_key TEXT NOT NULL DEFAULT '',
				provider_type TEXT NOT NULL DEFAULT '',
				model TEXT NOT NULL DEFAULT '',
				prompt_tokens INT NOT NULL DEFAULT 0,
				response_tokens INT NOT NULL DEFAULT 0,
				sources JSONB NOT NULL DEFAULT '[]'::jsonb,
				tool_calls JSONB NOT NULL DEFAULT '[]'::jsonb,
				error TEXT NOT NULL DEFAULT '',
				created_at TIMESTAMPTZ NOT NULL DEFAULT now()
			)
		`).Exec(ctx); err != nil {
			return fmt.Errorf("migration 57 (ai_messages): %w", err)
		}

		if _, err := db.NewRaw(`
			CREATE TABLE IF NOT EXISTS ai_knowledge_chunks (
				id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
				owner_user_id UUID,
				owner_org_id UUID,
				resource_type TEXT NOT NULL,
				resource_id TEXT NOT NULL,
				parent_resource_type TEXT NOT NULL DEFAULT '',
				parent_resource_id TEXT NOT NULL DEFAULT '',
				title TEXT NOT NULL DEFAULT '',
				content TEXT NOT NULL,
				search_text TEXT NOT NULL DEFAULT '',
				metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
				content_hash TEXT NOT NULL,
				source_updated_at TIMESTAMPTZ,
				indexed_at TIMESTAMPTZ NOT NULL DEFAULT now()
			)
		`).Exec(ctx); err != nil {
			return fmt.Errorf("migration 57 (ai_knowledge_chunks): %w", err)
		}

		if _, err := db.NewRaw(`CREATE INDEX IF NOT EXISTS ai_conversations_user_id_idx ON ai_conversations (user_id)`).Exec(ctx); err != nil {
			return fmt.Errorf("migration 57 (ai_conversations_user_id_idx): %w", err)
		}
		if _, err := db.NewRaw(`CREATE INDEX IF NOT EXISTS ai_conversations_owner_user_id_idx ON ai_conversations (owner_user_id)`).Exec(ctx); err != nil {
			return fmt.Errorf("migration 57 (ai_conversations_owner_user_id_idx): %w", err)
		}
		if _, err := db.NewRaw(`CREATE INDEX IF NOT EXISTS ai_conversations_owner_org_id_idx ON ai_conversations (owner_org_id)`).Exec(ctx); err != nil {
			return fmt.Errorf("migration 57 (ai_conversations_owner_org_id_idx): %w", err)
		}
		if _, err := db.NewRaw(`CREATE INDEX IF NOT EXISTS ai_conversations_scope_idx ON ai_conversations (scope_type, scope_ref)`).Exec(ctx); err != nil {
			return fmt.Errorf("migration 57 (ai_conversations_scope_idx): %w", err)
		}
		if _, err := db.NewRaw(`CREATE INDEX IF NOT EXISTS ai_messages_conversation_id_idx ON ai_messages (conversation_id, created_at)`).Exec(ctx); err != nil {
			return fmt.Errorf("migration 57 (ai_messages_conversation_id_idx): %w", err)
		}
		if _, err := db.NewRaw(`CREATE INDEX IF NOT EXISTS ai_knowledge_chunks_owner_user_id_idx ON ai_knowledge_chunks (owner_user_id)`).Exec(ctx); err != nil {
			return fmt.Errorf("migration 57 (ai_knowledge_chunks_owner_user_id_idx): %w", err)
		}
		if _, err := db.NewRaw(`CREATE INDEX IF NOT EXISTS ai_knowledge_chunks_owner_org_id_idx ON ai_knowledge_chunks (owner_org_id)`).Exec(ctx); err != nil {
			return fmt.Errorf("migration 57 (ai_knowledge_chunks_owner_org_id_idx): %w", err)
		}
		if _, err := db.NewRaw(`CREATE INDEX IF NOT EXISTS ai_knowledge_chunks_resource_idx ON ai_knowledge_chunks (resource_type, resource_id)`).Exec(ctx); err != nil {
			return fmt.Errorf("migration 57 (ai_knowledge_chunks_resource_idx): %w", err)
		}

		return nil
	}, func(ctx context.Context, db *bun.DB) error {
		db.NewRaw(`DROP TABLE IF EXISTS ai_messages CASCADE`).Exec(ctx)         //nolint:errcheck
		db.NewRaw(`DROP TABLE IF EXISTS ai_knowledge_chunks CASCADE`).Exec(ctx) //nolint:errcheck
		db.NewRaw(`DROP TABLE IF EXISTS ai_conversations CASCADE`).Exec(ctx)    //nolint:errcheck
		_, err := db.NewRaw(`DROP TABLE IF EXISTS ai_provider_settings CASCADE`).Exec(ctx)
		return err
	})
}
