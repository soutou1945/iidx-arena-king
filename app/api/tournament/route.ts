type Stage = "preliminary" | "king" | "middle" | "reverse";
type ResultInput = { participantId: number; points: number; placement: number; selectedChart: string };

async function database() {
  const { env } = await import("cloudflare:workers");
  if (!env.DB) throw new Error("大会データベースに接続できませんでした。");
  return env.DB;
}

async function readTournament(requestedTournamentId?: number) {
  const db = await database();
  const tournamentRows = await db.prepare("SELECT id, name, event_date AS eventDate, created_at AS createdAt FROM tournaments ORDER BY id DESC").all();
  const tournaments = tournamentRows.results as Array<{ id: number; name: string; eventDate: string; createdAt: string }>;
  const tournament = tournaments.find((row) => row.id === requestedTournamentId) ?? tournaments[0] ?? null;
  if (!tournament) return { tournaments, tournament: null, participants: [], matches: [], results: [] };
  const [participants, matches, results] = await Promise.all([
    db.prepare("SELECT id, name, created_at AS createdAt FROM participants WHERE tournament_id = ? ORDER BY id").bind(tournament.id).all(),
    db.prepare("SELECT id, stage, round_number AS roundNumber, created_at AS createdAt FROM matches WHERE tournament_id = ? ORDER BY id").bind(tournament.id).all(),
    db.prepare("SELECT id, match_id AS matchId, participant_id AS participantId, points, placement, selected_chart AS selectedChart FROM results WHERE match_id IN (SELECT id FROM matches WHERE tournament_id = ?) ORDER BY match_id, placement").bind(tournament.id).all(),
  ]);
  return { tournaments, tournament, participants: participants.results, matches: matches.results, results: results.results };
}

function errorResponse(error: unknown) {
  const message = error instanceof Error ? error.message : "処理に失敗しました。";
  return Response.json({ error: message }, { status: 500 });
}

export async function GET(request: Request) {
  try {
    const value = new URL(request.url).searchParams.get("tournamentId");
    return Response.json(await readTournament(value ? Number(value) : undefined));
  } catch (error) { return errorResponse(error); }
}

export async function POST(request: Request) {
  try {
    const payload = await request.json() as {
      action?: string; name?: string; participantId?: number; matchId?: number;
      tournamentId?: number; tournamentName?: string; eventDate?: string;
      stage?: Stage; results?: ResultInput[];
    };
    const db = await database();

    if (payload.action === "createTournament") {
      const tournamentName = payload.tournamentName?.trim() ?? "";
      if (!tournamentName) return Response.json({ error: "大会名を入力してください。" }, { status: 400 });
      const created = await db.prepare("INSERT INTO tournaments (name, event_date) VALUES (?, ?) RETURNING id").bind(tournamentName, payload.eventDate ?? "").first<{ id: number }>();
      if (!created) throw new Error("大会を作成できませんでした。");
      return Response.json(await readTournament(created.id));
    }

    if (!payload.tournamentId) return Response.json({ error: "大会を選択してください。" }, { status: 400 });

    if (payload.action === "addParticipant") {
      const name = payload.name?.trim() ?? "";
      if (!name) return Response.json({ error: "参加者名を入力してください。" }, { status: 400 });
      const count = await db.prepare("SELECT COUNT(*) AS count FROM participants WHERE tournament_id = ?").bind(payload.tournamentId).first<{ count: number }>();
      if ((count?.count ?? 0) >= 12) return Response.json({ error: "参加者は12名までです。" }, { status: 400 });
      await db.prepare("INSERT INTO participants (tournament_id, name) VALUES (?, ?)").bind(payload.tournamentId, name).run();
    } else if (payload.action === "deleteParticipant") {
      if (!payload.participantId) return Response.json({ error: "参加者が不正です。" }, { status: 400 });
      const used = await db.prepare("SELECT 1 FROM results WHERE participant_id = ? LIMIT 1").bind(payload.participantId).first();
      if (used) return Response.json({ error: "試合結果が登録済みの参加者は削除できません。" }, { status: 400 });
      await db.prepare("DELETE FROM participants WHERE id = ? AND tournament_id = ?").bind(payload.participantId, payload.tournamentId).run();
    } else if (payload.action === "addMatch") {
      const stage = payload.stage;
      const rows = payload.results ?? [];
      if (!stage || !["preliminary", "king", "middle", "reverse"].includes(stage)) return Response.json({ error: "試合区分が不正です。" }, { status: 400 });
      if (rows.length !== 4 || new Set(rows.map((row) => row.participantId)).size !== 4) return Response.json({ error: "異なる4名の結果を入力してください。" }, { status: 400 });
      if (new Set(rows.map((row) => row.placement)).size !== 4 || rows.some((row) => row.placement < 1 || row.placement > 4)) return Response.json({ error: "順位は1〜4位を1人ずつ指定してください。" }, { status: 400 });
      const next = await db.prepare("SELECT COALESCE(MAX(round_number), 0) + 1 AS number FROM matches WHERE tournament_id = ? AND stage = ?").bind(payload.tournamentId, stage).first<{ number: number }>();
      const created = await db.prepare("INSERT INTO matches (tournament_id, stage, round_number) VALUES (?, ?, ?) RETURNING id").bind(payload.tournamentId, stage, next?.number ?? 1).first<{ id: number }>();
      if (!created) throw new Error("試合を作成できませんでした。");
      await db.batch(rows.map((row) => db.prepare("INSERT INTO results (match_id, participant_id, points, placement, selected_chart) VALUES (?, ?, ?, ?, ?)").bind(created.id, row.participantId, row.points, row.placement, row.selectedChart.trim())));
    } else if (payload.action === "deleteMatch") {
      if (!payload.matchId) return Response.json({ error: "試合が不正です。" }, { status: 400 });
      await db.prepare("DELETE FROM matches WHERE id = ? AND tournament_id = ?").bind(payload.matchId, payload.tournamentId).run();
    } else if (payload.action === "resetTournament") {
      await db.batch([
        db.prepare("DELETE FROM results WHERE match_id IN (SELECT id FROM matches WHERE tournament_id = ?)").bind(payload.tournamentId),
        db.prepare("DELETE FROM matches WHERE tournament_id = ?").bind(payload.tournamentId),
        db.prepare("DELETE FROM participants WHERE tournament_id = ?").bind(payload.tournamentId),
      ]);
    } else {
      return Response.json({ error: "操作が不正です。" }, { status: 400 });
    }
    return Response.json(await readTournament(payload.tournamentId));
  } catch (error) { return errorResponse(error); }
}
