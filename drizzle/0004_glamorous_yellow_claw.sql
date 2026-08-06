CREATE TABLE "family" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"primary_guardian_name" text NOT NULL,
	"email" text NOT NULL,
	"phone" text,
	"preferred_language" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "family" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "guardian" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"family_id" uuid NOT NULL,
	"name" text NOT NULL,
	"email" text,
	"phone" text,
	"preferred_language" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "guardian" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "student" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"family_id" uuid NOT NULL,
	"first_name" text NOT NULL,
	"last_name" text NOT NULL,
	"date_of_birth" date NOT NULL,
	"current_level_id" uuid,
	"medical_notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "student" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "family" ADD CONSTRAINT "family_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guardian" ADD CONSTRAINT "guardian_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guardian" ADD CONSTRAINT "guardian_family_id_family_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."family"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student" ADD CONSTRAINT "student_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student" ADD CONSTRAINT "student_family_id_family_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."family"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student" ADD CONSTRAINT "student_current_level_id_level_id_fk" FOREIGN KEY ("current_level_id") REFERENCES "public"."level"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "family_organization_id_idx" ON "family" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "guardian_organization_id_idx" ON "guardian" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "guardian_family_id_idx" ON "guardian" USING btree ("family_id");--> statement-breakpoint
CREATE INDEX "student_organization_id_idx" ON "student" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "student_family_id_idx" ON "student" USING btree ("family_id");--> statement-breakpoint
CREATE INDEX "student_current_level_id_idx" ON "student" USING btree ("current_level_id");--> statement-breakpoint
CREATE POLICY "family_tenant_isolation" ON "family" AS PERMISSIVE FOR ALL TO public USING (organization_id = current_setting('app.current_org_id', true)) WITH CHECK (organization_id = current_setting('app.current_org_id', true));--> statement-breakpoint
CREATE POLICY "guardian_tenant_isolation" ON "guardian" AS PERMISSIVE FOR ALL TO public USING (organization_id = current_setting('app.current_org_id', true)) WITH CHECK (organization_id = current_setting('app.current_org_id', true));--> statement-breakpoint
CREATE POLICY "student_tenant_isolation" ON "student" AS PERMISSIVE FOR ALL TO public USING (organization_id = current_setting('app.current_org_id', true)) WITH CHECK (organization_id = current_setting('app.current_org_id', true));