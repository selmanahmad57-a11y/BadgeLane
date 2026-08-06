CREATE TYPE "public"."staff_role" AS ENUM('owner', 'admin', 'coach');--> statement-breakpoint
CREATE TABLE "organization" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"timezone" text NOT NULL,
	"currency" text NOT NULL,
	"country" text NOT NULL,
	"supported_languages" text[] NOT NULL,
	"stripe_account_id" text,
	"public_booking_enabled" boolean DEFAULT false NOT NULL,
	"settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "organization" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "staff_user" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"auth_id" text NOT NULL,
	"email" text NOT NULL,
	"full_name" text,
	"role" "staff_role" NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "staff_user" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "staff_user" ADD CONSTRAINT "staff_user_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "staff_user_organization_auth_id_key" ON "staff_user" USING btree ("organization_id","auth_id");--> statement-breakpoint
CREATE INDEX "staff_user_organization_id_idx" ON "staff_user" USING btree ("organization_id");--> statement-breakpoint
CREATE POLICY "organization_tenant_isolation" ON "organization" AS PERMISSIVE FOR ALL TO public USING (id = current_setting('app.current_org_id', true)) WITH CHECK (id = current_setting('app.current_org_id', true));--> statement-breakpoint
CREATE POLICY "staff_user_tenant_isolation" ON "staff_user" AS PERMISSIVE FOR ALL TO public USING (organization_id = current_setting('app.current_org_id', true)) WITH CHECK (organization_id = current_setting('app.current_org_id', true));