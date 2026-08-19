import { requireSupabase } from "../lib/supabase";
import { createEmptyTagTournamentData, type TagTournamentData } from "../types/tagTournament";
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
type ParticipantRow = { id:number; name:string; title?:string|null; image_url?:string|null; created_at:string };
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

/** 既存の配列形式は個人戦、新しいオブジェクト形式はタッグ戦として読み分けます。 */
function toTournamentFormatData(value:unknown):{
  format:Tournament["format"];
  drawSchedule:DrawMatch[];
  tagData:TagTournamentData|null;
}{
  if(Array.isArray(value)) return {format:"individual",drawSchedule:toDrawSchedule(value),tagData:null};
  if(value && typeof value==="object"){
    const stored=value as {format?:unknown;tagData?:unknown};
    if(stored.format==="tag" && stored.tagData && typeof stored.tagData==="object"){
      const tagData=stored.tagData as Partial<TagTournamentData>;
      if(Array.isArray(tagData.teams) && Array.isArray(tagData.matches) && Array.isArray(tagData.preliminaryTieBreaks)){
        return {
          format:"tag",
          drawSchedule:[],
          tagData:{
            version:1,
            teams:tagData.teams,
            matches:tagData.matches,
            preliminaryTieBreaks:tagData.preliminaryTieBreaks,
            calledMatchId:typeof tagData.calledMatchId==="string" ? tagData.calledMatchId : "",
          },
        };
      }
    }
  }
  return {format:"individual",drawSchedule:[],tagData:null};
}

function toTournament(row:TournamentRow):Tournament {
  const formatData=toTournamentFormatData(row.draw_schedule);
  return {
    id: row.id,
    name: row.name,
    eventDate: row.event_date ?? "",
    createdAt: row.created_at,
    isArchived: row.is_archived ?? false,
    format:formatData.format,
    drawSchedule:formatData.drawSchedule,
    tagData:formatData.tagData,
    calledMatchNumber: row.called_match_number,
  };
}
function toParticipant(row:ParticipantRow):Participant {
  return {
    id: row.id,
    name: row.name,
    title: row.title ?? "",
    imageUrl: row.image_url ?? "",
    createdAt: row.created_at,
  };
}
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
  const [currentParticipantsResponse,matchesResponse]=await Promise.all([
    client.from("participants").select("id,name,title,image_url,created_at").eq("tournament_id",tournament.id).order("id"),
    client.from("matches").select("id,stage,round_number,created_at").eq("tournament_id",tournament.id).order("id")
  ]);
  let participantRows:unknown[]=currentParticipantsResponse.data ?? [];
  let participantError=currentParticipantsResponse.error;

  // DB更新前でも既存大会の閲覧だけは継続できるよう、旧列構成へ退避します。
  if(currentParticipantsResponse.error?.message.includes("title") || currentParticipantsResponse.error?.message.includes("image_url")){
    const legacyParticipantsResponse=await client.from("participants").select("id,name,created_at").eq("tournament_id",tournament.id).order("id");
    participantRows=legacyParticipantsResponse.data ?? [];
    participantError=legacyParticipantsResponse.error;
  }
  assertSuccess(participantError); assertSuccess(matchesResponse.error);
  const participants=(participantRows as ParticipantRow[]).map(toParticipant);
  const matches=((matchesResponse.data ?? []) as MatchRow[]).map(toMatch);
  let results:Result[]=[];
  if(matches.length>0){
    const response=await client.from("results").select("id,match_id,participant_id,points,placement,selected_chart").in("match_id",matches.map((match)=>match.id)).order("match_id").order("placement");
    assertSuccess(response.error); results=((response.data ?? []) as ResultRow[]).map(toResult);
  }
  return {tournaments,tournament,participants,matches,results};
}

const PLAYER_IMAGES_BUCKET="player-images";
const MAX_PLAYER_IMAGE_SIZE=5*1024*1024;
const PLAYER_IMAGE_TYPES=new Set(["image/jpeg","image/png","image/webp"]);

/** 選手画像を安全な形式・サイズに限定してStorageへ保存します。 */
async function uploadParticipantImage(tournamentId:number,participantId:number,file:File):Promise<string>{
  if(!PLAYER_IMAGE_TYPES.has(file.type)) throw new Error("選手画像はJPEG・PNG・WebP形式を選択してください。");
  if(file.size>MAX_PLAYER_IMAGE_SIZE) throw new Error("選手画像は5MB以下にしてください。");

  const extensionByType:Record<string,string>={"image/jpeg":"jpg","image/png":"png","image/webp":"webp"};
  const objectPath=`${tournamentId}/${participantId}/${crypto.randomUUID()}.${extensionByType[file.type]}`;
  const client=requireSupabase();
  const uploadResponse=await client.storage.from(PLAYER_IMAGES_BUCKET).upload(objectPath,file,{contentType:file.type,upsert:false});
  assertSuccess(uploadResponse.error);
  return client.storage.from(PLAYER_IMAGES_BUCKET).getPublicUrl(objectPath).data.publicUrl;
}

/** 公開URLからStorage内のオブジェクトパスだけを取り出します。 */
function getPlayerImagePath(imageUrl:string):string|null{
  const marker=`/storage/v1/object/public/${PLAYER_IMAGES_BUCKET}/`;
  const markerIndex=imageUrl.indexOf(marker);
  if(markerIndex<0) return null;
  return decodeURIComponent(imageUrl.slice(markerIndex+marker.length));
}

/** DB更新後の古い画像削除は、参加者データを優先してベストエフォートで行います。 */
async function removeParticipantImage(imageUrl:string):Promise<void>{
  const objectPath=getPlayerImagePath(imageUrl);
  if(!objectPath) return;
  await requireSupabase().storage.from(PLAYER_IMAGES_BUCKET).remove([objectPath]);
}

/** ログイン済み運営者の更新要求をSupabaseへ反映します。 */
export async function mutateTournament(payload:MutationPayload,tournamentId?:number):Promise<TournamentData>{
  const client=requireSupabase();
  if(payload.action==="createTournament"){
    const name=payload.tournamentName?.trim() ?? ""; if(!name) throw new Error("大会名を入力してください。");
    // 過去回として作成した大会は、最新IDでもアーカイブ扱いにできるよう明示的に保存します。
    const tournamentFormat=payload.tournamentFormat ?? "individual";
    let storedDrawData:unknown=[];
    if(tournamentFormat==="tag") storedDrawData={format:"tag",tagData:createEmptyTagTournamentData()};
    const response=await client.from("tournaments").insert({
      name,
      event_date:payload.eventDate || null,
      is_archived:payload.isArchived ?? false,
      draw_schedule:storedDrawData,
    }).select("id").single();
    assertSuccess(response.error); return loadTournament((response.data as {id:number}).id);
  }
  if(!tournamentId) throw new Error("大会を選択してください。");
  if(payload.action==="addParticipant"){
    const name=payload.name?.trim() ?? ""; if(!name) throw new Error("参加者名を入力してください。");
    const title=payload.title?.trim() ?? "";
    const response=await client.from("participants").insert({tournament_id:tournamentId,name,title}).select("id").single();
    assertSuccess(response.error);
    const participantId=(response.data as {id:number}).id;

    if(payload.imageFile){
      let uploadedImageUrl="";
      try{
        uploadedImageUrl=await uploadParticipantImage(tournamentId,participantId,payload.imageFile);
        const imageResponse=await client.from("participants").update({image_url:uploadedImageUrl}).eq("id",participantId).eq("tournament_id",tournamentId);
        assertSuccess(imageResponse.error);
      }catch(caught){
        // 画像登録に失敗した場合は、不完全な参加者レコードを残しません。
        if(uploadedImageUrl) await removeParticipantImage(uploadedImageUrl);
        await client.from("participants").delete().eq("id",participantId).eq("tournament_id",tournamentId);
        throw caught;
      }
    }
  }else if(payload.action==="updateParticipant"){
    const participantId=payload.participantId ?? 0;
    const name=payload.name?.trim() ?? ""; if(!name) throw new Error("参加者名を入力してください。");
    const currentResponse=await client.from("participants").select("image_url").eq("id",participantId).eq("tournament_id",tournamentId).single();
    assertSuccess(currentResponse.error);
    const currentImageUrl=(currentResponse.data as {image_url:string|null}).image_url ?? "";
    let nextImageUrl=currentImageUrl;
    let uploadedImageUrl="";

    if(payload.removeImage) nextImageUrl="";
    if(payload.imageFile){
      uploadedImageUrl=await uploadParticipantImage(tournamentId,participantId,payload.imageFile);
      nextImageUrl=uploadedImageUrl;
    }

    const response=await client.from("participants").update({
      name,
      title:payload.title?.trim() ?? "",
      image_url:nextImageUrl,
    }).eq("id",participantId).eq("tournament_id",tournamentId);
    if(response.error){
      if(uploadedImageUrl) await removeParticipantImage(uploadedImageUrl);
      assertSuccess(response.error);
    }
    if(currentImageUrl && currentImageUrl!==nextImageUrl) await removeParticipantImage(currentImageUrl);
  }else if(payload.action==="deleteParticipant"){
    const participantId=payload.participantId ?? 0;
    const currentResponse=await client.from("participants").select("image_url").eq("id",participantId).eq("tournament_id",tournamentId).maybeSingle();
    assertSuccess(currentResponse.error);
    const response=await client.from("participants").delete().eq("id",participantId).eq("tournament_id",tournamentId); assertSuccess(response.error);
    const imageUrl=(currentResponse.data as {image_url:string|null}|null)?.image_url ?? "";
    if(imageUrl) await removeParticipantImage(imageUrl);
  }else if(payload.action==="addMatch"){
    if(!payload.stage || !payload.results) throw new Error("試合結果が不足しています。");
    const response=await client.rpc("create_match_with_results",{p_tournament_id:tournamentId,p_stage:payload.stage,p_results:payload.results.map((row)=>({participant_id:row.participantId,points:row.points,placement:row.placement,selected_chart:row.selectedChart.trim()}))}); assertSuccess(response.error);
  }else if(payload.action==="updateMatch"){
    if(!payload.matchId || !payload.stage || !payload.results) throw new Error("更新する試合結果が不足しています。");
    // 試合と4名分の結果は、途中状態を残さないようDB関数内の1トランザクションで更新します。
    const response=await client.rpc("update_match_with_results",{
      p_tournament_id:tournamentId,
      p_match_id:payload.matchId,
      p_stage:payload.stage,
      p_results:payload.results.map((row)=>({
        participant_id:row.participantId,
        points:row.points,
        placement:row.placement,
        selected_chart:row.selectedChart.trim(),
      })),
    });
    assertSuccess(response.error);
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
  }else if(payload.action==="saveTagTournament"){
    if(!payload.tagData) throw new Error("タッグ戦データがありません。");
    // 既存JSON列へまとめて保存するため、DBのテーブル・列追加は不要です。
    const response=await client.from("tournaments").update({
      draw_schedule:{format:"tag",tagData:payload.tagData},
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
