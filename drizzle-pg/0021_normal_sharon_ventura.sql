CREATE TABLE "project_domains" (
	"project_id" text NOT NULL,
	"domain" text NOT NULL,
	"created_at" text DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL,
	CONSTRAINT "project_domains_project_id_domain_pk" PRIMARY KEY("project_id","domain")
);
--> statement-breakpoint
INSERT INTO "project_domains" ("project_id", "domain")
SELECT "id", "domain" FROM "projects"
WHERE "domain" IS NOT NULL
ON CONFLICT DO NOTHING;--> statement-breakpoint
DROP INDEX "gsc_connections_project_idx";--> statement-breakpoint
ALTER TABLE "gsc_connections" ADD COLUMN "domain" text;--> statement-breakpoint
UPDATE "gsc_connections"
SET "domain" = CASE
  WHEN "site_url" LIKE 'sc-domain:www.%' THEN lower(substring("site_url" from 15))
  WHEN "site_url" LIKE 'sc-domain:%' THEN lower(substring("site_url" from 11))
  WHEN "site_url" LIKE 'https://www.%' THEN lower(split_part(substring("site_url" from 13), '/', 1))
  WHEN "site_url" LIKE 'https://%' THEN lower(split_part(substring("site_url" from 9), '/', 1))
  WHEN "site_url" LIKE 'http://www.%' THEN lower(split_part(substring("site_url" from 12), '/', 1))
  ELSE lower(split_part(substring("site_url" from 8), '/', 1))
END;--> statement-breakpoint
ALTER TABLE "gsc_connections" ALTER COLUMN "domain" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "project_domains" ADD CONSTRAINT "project_domains_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "project_domains_project_created_idx" ON "project_domains" USING btree ("project_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "gsc_connections_project_domain_idx" ON "gsc_connections" USING btree ("project_id","domain");
