CREATE TYPE "public"."progress_status" AS ENUM('in_progress', 'achieved');--> statement-breakpoint
CREATE TABLE "skill_progress" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"student_id" uuid NOT NULL,
	"skill_id" uuid NOT NULL,
	"status" "progress_status" NOT NULL,
	"achieved_at" timestamp with time zone,
	"coach_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "skill_progress" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "skill_progress" ADD CONSTRAINT "skill_progress_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skill_progress" ADD CONSTRAINT "skill_progress_student_id_student_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."student"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skill_progress" ADD CONSTRAINT "skill_progress_skill_id_skill_id_fk" FOREIGN KEY ("skill_id") REFERENCES "public"."skill"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skill_progress" ADD CONSTRAINT "skill_progress_coach_id_staff_user_id_fk" FOREIGN KEY ("coach_id") REFERENCES "public"."staff_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "skill_progress_student_skill_key" ON "skill_progress" USING btree ("organization_id","student_id","skill_id");--> statement-breakpoint
CREATE INDEX "skill_progress_organization_id_idx" ON "skill_progress" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "skill_progress_student_id_idx" ON "skill_progress" USING btree ("student_id");--> statement-breakpoint
CREATE POLICY "skill_progress_tenant_isolation" ON "skill_progress" AS PERMISSIVE FOR ALL TO public USING (organization_id = current_setting('app.current_org_id', true)) WITH CHECK (organization_id = current_setting('app.current_org_id', true));