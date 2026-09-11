CREATE TABLE "cell_note" (
	"owner_id" text NOT NULL,
	"node_id" text NOT NULL,
	"month" text NOT NULL,
	"id" text NOT NULL,
	"created_at" bigint NOT NULL,
	"text" text NOT NULL,
	CONSTRAINT "cell_note_owner_id_node_id_month_id_pk" PRIMARY KEY("owner_id","node_id","month","id"),
	CONSTRAINT "cell_note_month_ck" CHECK ("cell_note"."month" in ('ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic')),
	CONSTRAINT "cell_note_text_ck" CHECK (char_length("cell_note"."text") <= 280)
);
--> statement-breakpoint
ALTER TABLE "ledger" ADD COLUMN "data_version" integer DEFAULT 2 NOT NULL;--> statement-breakpoint
ALTER TABLE "movement" ADD COLUMN "from_id" text;--> statement-breakpoint
ALTER TABLE "movement" ADD COLUMN "to_id" text;--> statement-breakpoint
ALTER TABLE "cell_note" ADD CONSTRAINT "cell_note_owner_id_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;