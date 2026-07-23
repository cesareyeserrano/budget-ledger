CREATE TABLE "account" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp,
	"refresh_token_expires_at" timestamp,
	"scope" text,
	"password" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "amount_cell" (
	"owner_id" text NOT NULL,
	"node_id" text NOT NULL,
	"month" text NOT NULL,
	"kind" text NOT NULL,
	"amount" bigint NOT NULL,
	CONSTRAINT "amount_cell_owner_id_node_id_month_kind_pk" PRIMARY KEY("owner_id","node_id","month","kind"),
	CONSTRAINT "amount_cell_month_ck" CHECK ("amount_cell"."month" in ('ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic')),
	CONSTRAINT "amount_cell_kind_ck" CHECK ("amount_cell"."kind" in ('budget','actual')),
	CONSTRAINT "amount_cell_amount_ck" CHECK ("amount_cell"."amount" >= 0)
);
--> statement-breakpoint
CREATE TABLE "ledger" (
	"owner_id" text PRIMARY KEY NOT NULL,
	"revision" bigint DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "movement" (
	"owner_id" text NOT NULL,
	"id" text NOT NULL,
	"type" text NOT NULL,
	"cat_id" text NOT NULL,
	"sub_id" text,
	"target" text NOT NULL,
	"amount" bigint NOT NULL,
	"month" text NOT NULL,
	"created_at" bigint NOT NULL,
	"date" text,
	"note" text,
	CONSTRAINT "movement_owner_id_id_pk" PRIMARY KEY("owner_id","id"),
	CONSTRAINT "movement_type_ck" CHECK ("movement"."type" in ('expense','income','transfer')),
	CONSTRAINT "movement_month_ck" CHECK ("movement"."month" in ('ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic')),
	CONSTRAINT "movement_amount_ck" CHECK ("movement"."amount" >= 1)
);
--> statement-breakpoint
CREATE TABLE "node" (
	"owner_id" text NOT NULL,
	"id" text NOT NULL,
	"type" text NOT NULL,
	"level" text NOT NULL,
	"parent_id" text,
	"name" text NOT NULL,
	"icon" text,
	"system" boolean DEFAULT false NOT NULL,
	"sort_order" integer NOT NULL,
	CONSTRAINT "node_owner_id_id_pk" PRIMARY KEY("owner_id","id"),
	CONSTRAINT "node_type_ck" CHECK ("node"."type" in ('expense','income','transfer')),
	CONSTRAINT "node_level_ck" CHECK ("node"."level" in ('group','category','sub'))
);
--> statement-breakpoint
CREATE TABLE "session" (
	"id" text PRIMARY KEY NOT NULL,
	"expires_at" timestamp NOT NULL,
	"token" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"user_id" text NOT NULL,
	CONSTRAINT "session_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "user_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "verification" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "amount_cell" ADD CONSTRAINT "amount_cell_owner_id_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger" ADD CONSTRAINT "ledger_owner_id_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "movement" ADD CONSTRAINT "movement_owner_id_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "node" ADD CONSTRAINT "node_owner_id_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "movement_owner_created_idx" ON "movement" USING btree ("owner_id","created_at");