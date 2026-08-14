import { sql } from "drizzle-orm";
import { integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const tournaments = sqliteTable("tournaments", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  eventDate: text("event_date").notNull().default(""),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const participants = sqliteTable("participants", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  tournamentId: integer("tournament_id").notNull().default(1).references(() => tournaments.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [uniqueIndex("participants_tournament_name_unique").on(table.tournamentId, table.name)]);

export const matches = sqliteTable("matches", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  tournamentId: integer("tournament_id").notNull().default(1).references(() => tournaments.id, { onDelete: "cascade" }),
  stage: text("stage", { enum: ["preliminary", "king", "middle", "reverse"] }).notNull(),
  roundNumber: integer("round_number").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const results = sqliteTable("results", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  matchId: integer("match_id").notNull().references(() => matches.id, { onDelete: "cascade" }),
  participantId: integer("participant_id").notNull().references(() => participants.id, { onDelete: "restrict" }),
  points: integer("points").notNull(),
  placement: integer("placement").notNull(),
  selectedChart: text("selected_chart").notNull().default(""),
}, (table) => [uniqueIndex("results_match_participant_unique").on(table.matchId, table.participantId)]);
