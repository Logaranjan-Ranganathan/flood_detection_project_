CREATE TABLE "admin_sessions" (
	"token_hash" text PRIMARY KEY NOT NULL,
	"admin_id" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "admins" (
	"admin_id" serial PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"name" text NOT NULL,
	"password_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_login_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "alerts" (
	"alert_id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "alerts_alert_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"alert_type" text NOT NULL,
	"severity" text NOT NULL,
	"device_id" text,
	"zone_id" text,
	"gateway_id" text,
	"message" text NOT NULL,
	"water_level_cm" double precision,
	"dedupe_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"acknowledged_at" timestamp with time zone,
	"acknowledged_by" integer
);
--> statement-breakpoint
CREATE TABLE "app_settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "device_credentials" (
	"credential_id" serial PRIMARY KEY NOT NULL,
	"device_id" text NOT NULL,
	"token_hash" text NOT NULL,
	"token_prefix" text NOT NULL,
	"label" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "devices" (
	"device_id" text PRIMARY KEY NOT NULL,
	"label" text NOT NULL,
	"gateway_id" text,
	"zone_id" text,
	"latitude" double precision,
	"longitude" double precision,
	"location_verified" boolean DEFAULT false NOT NULL,
	"location_source" text DEFAULT 'UNVERIFIED' NOT NULL,
	"calib_zero_raw" integer,
	"calib_span_raw" integer,
	"calib_reference_cm" double precision,
	"calibration_verified" boolean DEFAULT false NOT NULL,
	"flow_supported" boolean DEFAULT false NOT NULL,
	"thresholds_override" jsonb,
	"last_seen_at" timestamp with time zone,
	"last_lora_rssi" integer,
	"last_lora_snr" double precision,
	"last_battery_voltage" double precision,
	"firmware_version" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "gateways" (
	"gateway_id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"firmware_version" text,
	"hardware_note" text,
	"last_seen_at" timestamp with time zone,
	"last_reported_ip" text,
	"network_status" text DEFAULT 'UNKNOWN' NOT NULL,
	"latitude" double precision,
	"longitude" double precision,
	"gps_fix" boolean,
	"last_lora_rssi" integer,
	"last_lora_snr" double precision,
	"battery_mv" integer,
	"packets_received" bigint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sensor_readings" (
	"reading_id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "sensor_readings_reading_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"device_id" text NOT NULL,
	"gateway_id" text,
	"raw_sensor_value" integer NOT NULL,
	"calibrated_water_level_cm" double precision,
	"water_flow_lpm" double precision,
	"flood_status" text NOT NULL,
	"data_quality" text DEFAULT 'OK' NOT NULL,
	"latitude" double precision,
	"longitude" double precision,
	"battery_voltage" double precision,
	"lora_rssi" integer,
	"lora_snr" double precision,
	"packet_sequence" integer,
	"firmware_version" text,
	"simulated" boolean DEFAULT false NOT NULL,
	"device_reported_at" timestamp with time zone,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"dedupe_key" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sensor_zones" (
	"zone_id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"center_latitude" double precision NOT NULL,
	"center_longitude" double precision NOT NULL,
	"radius_meters" integer DEFAULT 50 NOT NULL,
	"locality_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "admin_sessions" ADD CONSTRAINT "admin_sessions_admin_id_admins_admin_id_fk" FOREIGN KEY ("admin_id") REFERENCES "public"."admins"("admin_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_device_id_devices_device_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("device_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_zone_id_sensor_zones_zone_id_fk" FOREIGN KEY ("zone_id") REFERENCES "public"."sensor_zones"("zone_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_gateway_id_gateways_gateway_id_fk" FOREIGN KEY ("gateway_id") REFERENCES "public"."gateways"("gateway_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "device_credentials" ADD CONSTRAINT "device_credentials_device_id_devices_device_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("device_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "devices" ADD CONSTRAINT "devices_gateway_id_gateways_gateway_id_fk" FOREIGN KEY ("gateway_id") REFERENCES "public"."gateways"("gateway_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "devices" ADD CONSTRAINT "devices_zone_id_sensor_zones_zone_id_fk" FOREIGN KEY ("zone_id") REFERENCES "public"."sensor_zones"("zone_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sensor_readings" ADD CONSTRAINT "sensor_readings_device_id_devices_device_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("device_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sensor_readings" ADD CONSTRAINT "sensor_readings_gateway_id_gateways_gateway_id_fk" FOREIGN KEY ("gateway_id") REFERENCES "public"."gateways"("gateway_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "admins_email_idx" ON "admins" USING btree ("email");--> statement-breakpoint
CREATE UNIQUE INDEX "alerts_dedupe_idx" ON "alerts" USING btree ("dedupe_key");--> statement-breakpoint
CREATE INDEX "alerts_created_idx" ON "alerts" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "alerts_ack_idx" ON "alerts" USING btree ("acknowledged_at");--> statement-breakpoint
CREATE UNIQUE INDEX "device_credentials_token_idx" ON "device_credentials" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "device_credentials_device_idx" ON "device_credentials" USING btree ("device_id");--> statement-breakpoint
CREATE INDEX "devices_gateway_idx" ON "devices" USING btree ("gateway_id");--> statement-breakpoint
CREATE INDEX "devices_zone_idx" ON "devices" USING btree ("zone_id");--> statement-breakpoint
CREATE INDEX "devices_last_seen_idx" ON "devices" USING btree ("last_seen_at");--> statement-breakpoint
CREATE INDEX "gateways_last_seen_idx" ON "gateways" USING btree ("last_seen_at");--> statement-breakpoint
CREATE UNIQUE INDEX "readings_dedupe_idx" ON "sensor_readings" USING btree ("dedupe_key");--> statement-breakpoint
CREATE INDEX "readings_device_time_idx" ON "sensor_readings" USING btree ("device_id","received_at");--> statement-breakpoint
CREATE INDEX "readings_time_idx" ON "sensor_readings" USING btree ("received_at");