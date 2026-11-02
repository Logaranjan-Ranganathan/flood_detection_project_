ALTER TABLE "device_credentials" ALTER COLUMN "device_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "device_credentials" ADD COLUMN "gateway_id" text;--> statement-breakpoint
ALTER TABLE "device_credentials" ADD CONSTRAINT "device_credentials_gateway_id_gateways_gateway_id_fk" FOREIGN KEY ("gateway_id") REFERENCES "public"."gateways"("gateway_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "device_credentials_gateway_idx" ON "device_credentials" USING btree ("gateway_id");--> statement-breakpoint
ALTER TABLE "device_credentials" ADD CONSTRAINT "device_credentials_principal_chk" CHECK ((device_id is not null) <> (gateway_id is not null));