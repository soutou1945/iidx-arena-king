import { requireSupabase } from "../lib/supabase";
import type { DrawMatch, Match, MutationPayload, Participant, Result, Tournament, TournamentData } from "../types";

type TournamentRow = {
  id: number;
  name: string;
  event_date: string | null;
  created_at: string;
  is_archived?: boolean | null;
  draw_schedule: unknown;
  called_match_number: number | null;
};
type ParticipantRow = { id:number; name:string; created_at:string };
type MatchRow = { id:number; stage:Match["stage"]; round_number:number; created_at:string };
type ResultRow = { id:number; match_id:number; participant_id:number; points:number; placement:number; selected_chart:string };

/** DBに保存されたJSONが安全な抽選データか、最低限の形を確認します。 */
function toDrawSchedule(value: unknown): DrawMatch[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is DrawMatch => {
    if (!item || typeof item !== "object") return false;
    const row = item as Partial<DrawMatch>;
    return typeof row.matchNumber === "number" && typeof row.roundNumber === "number" &&
      typeof row.tableNumber === "number" && Array.isArray(row.participantIds) && Array.isArray(row.streamParticipantIds);
  });
}

function toTournament(row:TournamentRow):Tournament {
  return {
    id: row.id,
    name: row.name,
    eventDate: row.event_date ?? "",
    createdAt: row.created_at,
    isArchived: row.is_archived ?? false,
    drawSchedule: toDrawSchedule(row.draw_schedule),
    calledMatchNumber: row.called_match_number,
  };
}
function toParticipant(row:ParticipantRow):Participant { return { id:row.id, name:row.name, createdAt:row.created_at }; }
function toMatch(row:MatchRow):Match { return { id:row.id, stage:row.stage, roundNumber:row.round_number, createdAt:row.created_at }; }
function toResult(row:ResultRow):Result { return { id:row.id, matchId:row.match_id, participantId:row.participant_id, points:row.points, placement:row.placement, selectedChart:row.selected_chart }; }
function assertSuccess(error:{message:string}|null):void { if (error) throw new Error(error.message); }

/** 選択中の大会と参加者・試合・結果・抽選表をまとめて取得します。 */
export async function loadTournament(requestedTournamentId?:number):Promise<TournamentData> {
  const client=requireSupabase();
  const currentSchemaResponse=await client
    .from("tournaments")
    .select("id,name,event_date,created_at,is_archived,draw_schedule,called_match_number")
    .order("id",{ascending:false});

  let tournamentRows: unknown[] = currentSchemaResponse.data ?? [];
  let tournamentError = currentSchemaResponse.error;

  // SQL更新前に新しい画面が公開されても閲覧画面が停止しないよう、旧列構成へ一度だけ退避します。
  if(currentSchemaResponse.error?.message.includes("is_archived")){
    const legacySchemaResponse=await client
      .from("tournaments")
      .select("id,name,event_date,created_at,draw_schedule,called_match_number")
      .order("id",{ascending:false});
    tournamentRows = legacySchemaResponse.data ?? [];
    tournamentError = legacySchemaResponse.error;
  }
  assertSuccess(tournamentError);
  const tournaments=(tournamentRows as TournamentRow[]).map(toTournament);
  const tournament=tournaments.find((item)=>item.id===requestedTournamentId) ?? tournaments[0] ?? null;
  if(!tournament) return {tournaments,tournament:null,participants:[],matches:[],results:[]};
  const [participantsResponse,matchesResponse]=await Promise.all([
    client.from("participants").select("id,name,created_at").eq("tournament_id",tournament.id).order("id"),
    client.from("matches").select("id,stage,round_number,created_at").eq("tournament_id",tournament.id).order("id")
  ]);
  assertSuccess(participantsResponse.error); assertSuccess(matchesResponse.error);
  const participants=((participantsResponse.data ?? []) as ParticipantRow[]).map(toParticipant);
  const matches=((matchesResponse.data ?? []) as MatchRow[]).map(toMatch);
  let results:Result[]=[];
  if(matches.length>0){
    const response=await client.from("results").select("id,match_id,participant_id,points,placement,selected_chart").in("match_id",matches.map((match)=>match.id)).order("match_id").order("placement");
    assertSuccess(response.error); results=((response.data ?? []) as ResultRow[]).map(toResult);
  }
  return {tournaments,tournament,participants,matches,results};
}

/** ログイン済み運営者の更新要求をSupabaseへ反映します。 */
export async function mutateTournament(payload:MutationPayload,tournamentId?:number):Promise<TournamentData>{
  const client=requireSupabase();
  if(payload.action==="createTournament"){
    const name=payload.tournamentName?.trim() ?? ""; if(!name) throw new Error("大会名を入力してください。");
    // 過去回として作成した大会は、最新IDでもアーカイブ扱いにできるよう明示的に保存します。
    const response=await client.from("tournaments").insert({
      name,
      event_date:payload.eventDate || null,
      is_archived:payload.isArchived ?? false,
    }).select("id").single();
    assertSuccess(response.error); return loadTournament((response.data as {id:number}).id);
  }
  if(!tournamentId) throw new Error("大会を選択してください。");
  if(payload.action==="addParticipant"){
    const name=payload.name?.trim() ?? ""; if(!name) throw new Error("参加者名を入力してください。");
    const response=await client.from("participants").insert({tournament_id:tournamentId,name}); assertSuccess(response.error);
  }else if(payload.action==="deleteParticipant"){
    const response=await client.from("participants").delete().eq("id",payload.participantId ?? 0).eq("tournament_id",tournamentId); assertSuccess(response.error);
  }else if(payload.action==="addMatch"){
    if(!payload.stage || !payload.results) throw new Error("試合結果が不足しています。");
    const response=await client.rpc("create_match_with_results",{p_tournament_id:tournamentId,p_stage:payload.stage,p_results:payload.results.map((row)=>({participant_id:row.participantId,points:row.points,placement:row.placement,selected_chart:row.selectedChart.trim()}))}); assertSuccess(response.error);
  }else if(payload.action==="deleteMatch"){
    const response=await client.from("matches").delete().eq("id",payload.matchId ?? 0).eq("tournament_id",tournamentId); assertSuccess(response.error);
  }else if(payload.action==="saveDraw"){
    if(!payload.drawSchedule) throw new Error("組み合わせデータがありません。");
    if(payload.drawSchedule.length>18) throw new Error("予選の組み合わせは18試合までです。");

    // 過去回は資料が一部だけ残っている場合もあるため、1～18試合の途中状態も保存できます。
    let calledMatchNumber:number|null=null;
    if(payload.drawSchedule.length>0) calledMatchNumber=1;
    const response=await client.from("tournaments").update({
      draw_schedule:payload.drawSchedule,
      called_match_number:calledMatchNumber,
    }).eq("id",tournamentId);
    assertSuccess(response.error);
  }else if(payload.action==="callMatch"){
    const response=await client.from("tournaments").update({called_match_number:payload.calledMatchNumber ?? null}).eq("id",tournamentId); assertSuccess(response.error);
  }else if(payload.action==="resetTournament"){
    const matchesResponse=await client.from("matches").delete().eq("tournament_id",tournamentId); assertSuccess(matchesResponse.error);
    const participantsResponse=await client.from("participants").delete().eq("tournament_id",tournamentId); assertSuccess(participantsResponse.error);
    const tournamentResponse=await client.from("tournaments").update({draw_schedule:[],called_match_number:null}).eq("id",tournamentId); assertSuccess(tournamentResponse.error);
  }
  return loadTournament(tournamentId);
}
