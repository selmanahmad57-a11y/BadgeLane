CREATE TYPE "public"."enrollment_status" AS ENUM('active', 'waitlisted', 'paused', 'ended');--> statement-breakpoint
CREATE TABLE "enrollment" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"student_id" uuid NOT NULL,
	"klass_id" uuid NOT NULL,
	"status" "enrollment_status" DEFAULT 'active' NOT NULL,
	"waitlisted_at" timestamp with time zone,
	"start_date" date,
	"end_date" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "enrollment" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "enrollment" ADD CONSTRAINT "enrollment_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enrollment" ADD CONSTRAINT "enrollment_student_id_student_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."student"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enrollment" ADD CONSTRAINT "enrollment_klass_id_klass_id_fk" FOREIGN KEY ("klass_id") REFERENCES "public"."klass"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "enrollment_organization_id_idx" ON "enrollment" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "enrollment_klass_id_idx" ON "enrollment" USING btree ("klass_id");--> statement-breakpoint
CREATE INDEX "enrollment_student_id_idx" ON "enrollment" USING btree ("student_id");--> statement-breakpoint
CREATE POLICY "enrollment_tenant_isolation" ON "enrollment" AS PERMISSIVE FOR ALL TO public USING (organization_id = current_setting('app.current_org_id', true)) WITH CHECK (organization_id = current_setting('app.current_org_id', true));