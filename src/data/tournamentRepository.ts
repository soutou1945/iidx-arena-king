import { requireSupabase } from "../lib/supabase";
import type { Match, MutationPayload, Participant, Result, Tournament, TournamentData } from "../types";

type TournamentRow = { id: number; name: string; event_date: string | null; created_at: string };
type ParticipantRow = { id: number; name: string; created_at: string };
type MatchRow = { id: number; stage: Match["stage"]; round_number: number; created_at: string };
type ResultRow = { id: number; match_id: number; participant_id: number; points: number; placement: number; selected_chart: string };

/** Supabaseのsnake_caseをReact側で扱いやすいcamelCaseへ変換します。 */
function toTournament(row: TournamentRow): Tournament {
  return { id: row.id, name: row.name, eventDate: row.event_date ?? "", createdAt: row.created_at };
}

function toParticipant(row: ParticipantRow): Participant {
  return { id: row.id, name: row.name, createdAt: row.created_at };
}

function toMatch(row: MatchRow): Match {
  return { id: row.id, stage: row.stage, roundNumber: row.round_number, createdAt: row.created_at };
}

function toResult(row: ResultRow): Result {
  return {
    id: row.id,
    matchId: row.match_id,
    participantId: row.participant_id,
    points: row.points,
    placement: row.placement,
    selectedChart: row.selected_chart,
  };
}

/** Supabaseエラーを利用者に表示できる通常のErrorへ変換します。 */
function assertSuccess(error: { message: string } | null): void {
  if (error) throw new Error(error.message);
}

/**
 * 選択中の大会と、それに属する参加者・試合・結果をまとめて取得します。
 * 大会IDを省略した場合は、作成日時が最も新しい大会を表示します。
 */
export async function loadTournament(requestedTournamentId?: number): Promise<TournamentData> {
  const client = requireSupabase();
  const tournamentsResponse = await client
    .from("tournaments")
    .select("id,name,event_date,created_at")
    .order("id", { ascending: false });
  assertSuccess(tournamentsResponse.error);

  const tournaments = ((tournamentsResponse.data ?? []) as TournamentRow[]).map(toTournament);
  const tournament = tournaments.find((item) => item.id === requestedTournamentId) ?? tournaments[0] ?? null;
  if (!tournament) return { tournaments, tournament: null, participants: [], matches: [], results: [] };

  // 参加者と試合は互いに依存しないため、並列で取得して待ち時間を短縮します。
  const [participantsResponse, matchesResponse] = await Promise.all([
    client.from("participants").select("id,name,created_at").eq("tournament_id", tournament.id).order("id"),
    client.from("matches").select("id,stage,round_number,created_at").eq("tournament_id", tournament.id).order("id"),
  ]);
  assertSuccess(participantsResponse.error);
  assertSuccess(matchesResponse.error);

  const participants = ((participantsResponse.data ?? []) as ParticipantRow[]).map(toParticipant);
  const matches = ((matchesResponse.data ?? []) as MatchRow[]).map(toMatch);
  const matchIds = matches.map((match) => match.id);

  // 試合がない大会ではin句を発行せず、結果を空配列として扱います。
  let results: Result[] = [];
  if (matchIds.length > 0) {
    const resultsResponse = await client
      .from("results")
      .select("id,match_id,participant_id,points,placement,selected_chart")
      .in("match_id", matchIds)
      .order("match_id")
      .order("placement");
    assertSuccess(resultsResponse.error);
    results = ((resultsResponse.data ?? []) as ResultRow[]).map(toResult);
  }

  return { tournaments, tournament, participants, matches, results };
}

/**
 * 画面からの更新要求をSupabaseへ反映します。
 * RLSにより、ログインしていない閲覧者の更新はDB側でも拒否されます。
 */
export async function mutateTournament(payload: MutationPayload, tournamentId?: number): Promise<TournamentData> {
  const client = requireSupabase();

  if (payload.action === "createTournament") {
    const tournamentName = payload.tournamentName?.trim() ?? "";
    if (!tournamentName) throw new Error("大会名を入力してください。");
    const response = await client
      .from("tournaments")
      .insert({ name: tournamentName, event_date: payload.eventDate ?? "" })
      .select("id")
      .single();
    assertSuccess(response.error);
    return loadTournament((response.data as { id: number }).id);
  }

  if (!tournamentId) throw new Error("大会を選択してください。");

  if (payload.action === "addParticipant") {
    const name = payload.name?.trim() ?? "";
    if (!name) throw new Error("参加者名を入力してください。");
    const response = await client.from("participants").insert({ tournament_id: tournamentId, name });
    assertSuccess(response.error);
  } else if (payload.action === "deleteParticipant") {
    const response = await client.from("participants").delete().eq("id", payload.participantId ?? 0).eq("tournament_id", tournamentId);
    assertSuccess(response.error);
  } else if (payload.action === "addMatch") {
    if (!payload.stage || !payload.results) throw new Error("試合結果が不足しています。");
    // 試合と4人分の結果はPostgreSQL関数内で一括登録し、途中状態が残らないようにします。
    const response = await client.rpc("create_match_with_results", {
      p_tournament_id: tournamentId,
      p_stage: payload.stage,
      p_results: payload.results.map((row) => ({
        participant_id: row.participantId,
        points: row.points,
        placement: row.placement,
        selected_chart: row.selectedChart.trim(),
      })),
    });
    assertSuccess(response.error);
  } else if (payload.action === "deleteMatch") {
    const response = await client.from("matches").delete().eq("id", payload.matchId ?? 0).eq("tournament_id", tournamentId);
    assertSuccess(response.error);
  } else if (payload.action === "resetTournament") {
    // matchesを削除すると外部キーのCASCADEによりresultsも削除されます。
    const matchResponse = await client.from("matches").delete().eq("tournament_id", tournamentId);
    assertSuccess(matchResponse.error);
    const participantResponse = await client.from("participants").delete().eq("tournament_id", tournamentId);
    assertSuccess(participantResponse.error);
  }

  return loadTournament(tournamentId);
}
