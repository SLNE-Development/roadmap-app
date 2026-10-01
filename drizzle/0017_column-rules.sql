CREATE TABLE "column_rule" (
	"id" text PRIMARY KEY NOT NULL,
	"column_id" text NOT NULL,
	"rule" text NOT NULL,
	"param" integer,
	"sort_order" integer NOT NULL,
	CONSTRAINT "column_rule_column_rule" UNIQUE("column_id","rule")
);
--> statement-breakpoint
ALTER TABLE "column_rule" ADD CONSTRAINT "column_rule_column_id_board_column_id_fk" FOREIGN KEY ("column_id") REFERENCES "public"."board_column"("id") ON DELETE cascade ON UPDATE no action;