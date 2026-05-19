CREATE TABLE "gateway_secrets" (
	"name" text PRIMARY KEY NOT NULL,
	"value_ciphertext" text NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);

CREATE TABLE "model_providers" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"max_tokens" integer DEFAULT 8192 NOT NULL,
	"base_url" text,
	"api" text,
	"thinking" text,
	"secret_name" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);

CREATE INDEX "idx_model_providers_enabled" ON "model_providers" USING btree ("enabled");
