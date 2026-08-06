CREATE TYPE "public"."occurrence_status" AS ENUM('scheduled', 'cancelled');--> statement-breakpoint
CREATE TABLE "class_occurrence" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"klass_id" uuid NOT NULL,
	"date" date NOT NULL,
	"status" "occurrence_status" DEFAULT 'scheduled' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "class_occurrence" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "klass" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"term_id" uuid NOT NULL,
	"program_id" uuid NOT NULL,
	"level_id" uuid NOT NULL,
	"location_id" uuid NOT NULL,
	"instructor_id" uuid,
	"title" text NOT NULL,
	"day_of_week" smallint NOT NULL,
	"start_time" time NOT NULL,
	"duration_min" integer NOT NULL,
	"capacity" integer NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "klass" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "term" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"name" text NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	"enrollment_open" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "term" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "class_occurrence" ADD CONSTRAINT "class_occurrence_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "class_occurrence" ADD CONSTRAINT "class_occurrence_klass_id_klass_id_fk" FOREIGN KEY ("klass_id") REFERENCES "public"."klass"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "klass" ADD CONSTRAINT "klass_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "klass" ADD CONSTRAINT "klass_term_id_term_id_fk" FOREIGN KEY ("term_id") REFERENCES "public"."term"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "klass" ADD CONSTRAINT "klass_program_id_program_id_fk" FOREIGN KEY ("program_id") REFERENCES "public"."program"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "klass" ADD CONSTRAINT "klass_level_id_level_id_fk" FOREIGN KEY ("level_id") REFERENCES "public"."level"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "klass" ADD CONSTRAINT "klass_location_id_location_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."location"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "klass" ADD CONSTRAINT "klass_instructor_id_staff_user_id_fk" FOREIGN KEY ("instructor_id") REFERENCES "public"."staff_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "term" ADD CONSTRAINT "term_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "class_occurrence_klass_date_key" ON "class_occurrence" USING btree ("organization_id","klass_id","date");--> statement-breakpoint
CREATE INDEX "class_occurrence_organization_id_idx" ON "class_occurrence" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "class_occurrence_date_idx" ON "class_occurrence" USING btree ("date");--> statement-breakpoint
CREATE INDEX "klass_organization_id_idx" ON "klass" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "klass_term_id_idx" ON "klass" USING btree ("term_id");--> statement-breakpoint
CREATE INDEX "klass_instructor_id_idx" ON "klass" USING btree ("instructor_id");--> statement-breakpoint
CREATE INDEX "term_organization_id_idx" ON "term" USING btree ("organization_id");--> statement-breakpoint
CREATE POLICY "class_occurrence_tenant_isolation" ON "class_occurrence" AS PERMISSIVE FOR ALL TO public USING (organization_id = current_setting('app.current_org_id', true)) WITH CHECK (organization_id = current_setting('app.current_org_id', true));--> statement-breakpoint
CREATE POLICY "klass_tenant_isolation" ON "klass" AS PERMISSIVE FOR ALL TO public USING (organization_id = current_setting('app.current_org_id', true)) WITH CHECK (organization_id = current_setting('app.current_org_id', true));--> statement-breakpoint
CREATE POLICY "term_tenant_isolation" ON "term" AS PERMISSIVE FOR ALL TO public USING (organization_id = current_setting('app.current_org_id', true)) WITH CHECK (organization_id = current_setting('app.current_org_id', true));