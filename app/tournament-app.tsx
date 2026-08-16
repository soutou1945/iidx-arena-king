import { useEffect, useMemo, useState, type FormEvent } from "react";
import type { User } from "@supabase/supabase-js";
import { loadTournament, mutateTournament } from "../src/data/tournamentRepository";
import { generatePreliminaryDraw } from "../src/lib/draw";
import { isSupabaseConfigured, supabase } from "../src/lib/supabase";
import { emptyTournamentData, type DrawMatch, type MutationPayload, type Participant, type Stage, type TournamentData } from "../src/types";

type Tab = "standings" | "draw" | "matches" | "players" | "rules";
type Standing = Participant & { points:number; games:number; firsts:number; fourths:number; suddenDeath:boolean };
type DraftRow = { participantId:string; points:string; placement:string; selectedChart:string };
const initialRows:DraftRow[]=[1,2,3,4].map((placement)=>({participantId:"",points:"",placement:String(placement),selectedChart:""}));
const stageLabels:Record<Stage,string>={preliminary:"予選",king:"王決定戦",middle:"中位決定戦",reverse:"逆王決定戦"};
const tabLabels:Record<Tab,string>={standings:"順位表",draw:"抽選・呼び出し",matches:"試合履歴",players:"参加者",rules:"大会ルール"};

/** 合計pt→1位数→4位数で集計し、なお同点ならサドンデス対象として表示します。 */
function preliminaryStandings(data:TournamentData):Standing[]{
  const matchIds=new Set(data.matches.filter((match)=>match.stage==="preliminary").map((match)=>match.id));
  const results=data.results.filter((result)=>matchIds.has(result.matchId));
  const rows=data.participants.map((participant)=>{
    const own=results.filter((result)=>result.participantId===participant.id);
    return {...participant,points:own.reduce((sum,result)=>sum+result.points,0),games:own.length,
      firsts:own.filter((result)=>result.placement===1).length,fourths:own.filter((result)=>result.placement===4).length,suddenDeath:false};
  });
  rows.sort((left,right)=>right.points-left.points || right.firsts-left.firsts || left.fourths-right.fourths || left.id-right.id);
  rows.forEach((row,index)=>{
    row.suddenDeath=rows.some((other,otherIndex)=>otherIndex!==index && other.points===row.points && other.firsts===row.firsts && other.fourths===row.fourths);
  });
  return rows;
}

/** 順位決定戦は獲得pt順、同ptなら予選上位順に並べます。 */
function finalGroup(stage:Stage,data:TournamentData,preliminary:Standing[]){
  const ids=new Set(data.matches.filter((match)=>match.stage===stage).map((match)=>match.id));
  const results=data.results.filter((result)=>ids.has(result.matchId));
  let eligible:Standing[]=[];
  if(stage==="king") eligible=preliminary.slice(0,4);
  if(stage==="middle") eligible=preliminary.slice(4,8);
  if(stage==="reverse") eligible=preliminary.slice(8,12);
  return eligible.map((player)=>({...player,finalPoints:results.filter((result)=>result.participantId===player.id).reduce((sum,result)=>sum+result.points,0)}))
    .sort((left,right)=>right.finalPoints-left.finalPoints || preliminary.findIndex((row)=>row.id===left.id)-preliminary.findIndex((row)=>row.id===right.id));
}

function playerName(data:TournamentData,id:number):string{return data.participants.find((player)=>player.id===id)?.name ?? "未登録";}

/** 会場モニター用の公開呼び出し画面です。URLのcall=1で表示します。 */
function CallBoard({data}:{data:TournamentData}){
  const number=data.tournament?.calledMatchNumber ?? 1;
  const current=data.tournament?.drawSchedule.find((match)=>match.matchNumber===number);
  const next=data.tournament?.drawSchedule.find((match)=>match.matchNumber===number+1);
  if(!current) return <main className="call-board"><p className="call-kicker">IIDX LOCAL ARENA</p><h1>組み合わせ抽選待ち</h1><p>抽選完了後、この画面に呼び出し対象が表示されます。</p></main>;
  return <main className="call-board">
    <p className="call-kicker">NOW CALLING / ROUND {current.roundNumber}</p>
    <h1>第{current.matchNumber}試合 <span>集合してください</span></h1>
    <div className="call-players">{current.participantIds.map((id,index)=><article key={id} className={current.streamParticipantIds.includes(id)?"stream":""}>
      <small>PLAYER {index+1}</small><strong>{playerName(data,id)}</strong>{current.streamParticipantIds.includes(id)&&<b>● 配信台</b>}
    </article>)}</div>
    <div className="call-footer"><span>TABLE {current.tableNumber}</span>{next&&<p>次の試合：{next.participantIds.map((id)=>playerName(data,id)).join(" / ")}</p>}</div>
  </main>;
}

export default function TournamentApp(){
  const params=new URLSearchParams(window.location.search);
  const callMode=params.get("call")==="1";
  const requestedId=Number(params.get("tournament")) || undefined;
  const [data,setData]=useState<TournamentData>(emptyTournamentData);
  const [tab,setTab]=useState<Tab>("standings");
  const [loading,setLoading]=useState(true); const [busy,setBusy]=useState(false); const [error,setError]=useState("");
  const [user,setUser]=useState<User|null>(null); const [showLogin,setShowLogin]=useState(false);
  const [email,setEmail]=useState(""); const [password,setPassword]=useState("");
  const [name,setName]=useState(""); const [showTournament,setShowTournament]=useState(false);
  const [tournamentName,setTournamentName]=useState(""); const [eventDate,setEventDate]=useState("");
  const [showMatch,setShowMatch]=useState(false); const [stage,setStage]=useState<Stage>("preliminary"); const [rows,setRows]=useState<DraftRow[]>(initialRows);

  async function load(id?:number){try{setData(await loadTournament(id));setError("");}catch(caught){setError(caught instanceof Error?caught.message:"読込に失敗しました。");}finally{setLoading(false);}}
  useEffect(()=>{void load(requestedId);},[]);
  useEffect(()=>{
    if(!callMode) return;
    const timer=window.setInterval(()=>{void load(requestedId);},5000);
    return()=>window.clearInterval(timer);
  },[callMode,requestedId]);
  useEffect(()=>{
    if(!supabase) return;
    void supabase.auth.getSession().then(({data:session})=>setUser(session.session?.user ?? null));
    const {data:listener}=supabase.auth.onAuthStateChange((_event,session)=>setUser(session?.user ?? null));
    return()=>listener.subscription.unsubscribe();
  },[]);

  async function mutate(payload:MutationPayload){
    setBusy(true);setError("");
    try{if(!user) throw new Error("運営ログインが必要です。");setData(await mutateTournament(payload,data.tournament?.id));return true;}
    catch(caught){setError(caught instanceof Error?caught.message:"保存に失敗しました。");return false;}finally{setBusy(false);}
  }
  const standings=useMemo(()=>preliminaryStandings(data),[data]);
  const completed=standings.filter((row)=>row.games>=6).length;
  const prelimMatches=data.matches.filter((match)=>match.stage==="preliminary");
  const finalsReady=data.participants.length===12 && completed===12 && !standings.some((row)=>row.suddenDeath);

  if(callMode) return loading?<main className="call-board"><h1>読み込み中…</h1></main>:<CallBoard data={data}/>;

  async function login(event:FormEvent){event.preventDefault();if(!supabase)return;setBusy(true);const response=await supabase.auth.signInWithPassword({email,password});setBusy(false);if(response.error){setError("ログインできませんでした。");return;}setPassword("");setShowLogin(false);}
  async function addParticipant(event:FormEvent){event.preventDefault();if(await mutate({action:"addParticipant",name}))setName("");}
  async function createTournament(event:FormEvent){event.preventDefault();if(await mutate({action:"createTournament",tournamentName,eventDate})){setShowTournament(false);setTournamentName("");setEventDate("");}}
  function updateRow(index:number,key:keyof DraftRow,value:string){setRows((current)=>current.map((row,rowIndex)=>rowIndex===index?{...row,[key]:value}:row));}
  async function saveMatch(event:FormEvent){event.preventDefault();const ok=await mutate({action:"addMatch",stage,results:rows.map((row)=>({participantId:Number(row.participantId),points:Number(row.points),placement:Number(row.placement),selectedChart:row.selectedChart}))});if(ok){setRows(initialRows);setShowMatch(false);setTab("standings");}}
  function prepareResult(match:DrawMatch){setStage("preliminary");setRows(match.participantIds.map((id,index)=>({participantId:String(id),points:"",placement:String(index+1),selectedChart:""})));setShowMatch(true);}
  async function createDraw(){if(data.tournament?.drawSchedule.length && !window.confirm("現在の抽選結果を作り直しますか？"))return;try{const draw=generatePreliminaryDraw(data.participants);await mutate({action:"saveDraw",drawSchedule:draw});}catch(caught){setError(caught instanceof Error?caught.message:"抽選に失敗しました。");}}
  function openCallBoard(){if(!data.tournament)return;const url=`${window.location.pathname}?call=1&tournament=${data.tournament.id}`;window.open(url,"iidx-call-board");}

  return <main>
    <header className="topbar"><div className="brand"><span>王</span><div><strong>ARENA CROWN</strong><small>IIDX LOCAL TOURNAMENT</small></div></div><div className="header-actions">
      <label><small>大会</small><select value={data.tournament?.id ?? ""} onChange={(event)=>void load(Number(event.target.value))}>{data.tournaments.map((item)=><option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
      <button className="secondary" onClick={()=>user?setShowTournament(true):setShowLogin(true)}>新しい大会</button>
      <button className="primary" onClick={()=>user?setShowMatch(true):setShowLogin(true)} disabled={data.participants.length<4}>試合結果</button>
      <button className="auth-button" onClick={()=>user?void supabase?.auth.signOut():setShowLogin(true)}>{user?"ログアウト":"運営ログイン"}</button>
    </div></header>
    <section className="hero"><div><p className="eyebrow">18 MATCHES / 12 PLAYERS</p><h1>{data.tournament?.name ?? "大会を作成"}</h1><p>組み合わせ抽選から呼び出し、試合結果、最終順位までを一元管理します。</p></div><div className="hero-status"><small>PRELIMINARY</small><strong>{prelimMatches.length} / 18 試合</strong><div><i style={{width:`${Math.min(100,prelimMatches.length/18*100)}%`}}/></div><span>{completed} / 12人が6試合完了</span></div></section>
    {error&&<div className="error">{error}<button onClick={()=>setError("")}>×</button></div>}
    {!isSupabaseConfigured&&<div className="error">Supabaseの接続情報が未設定です。</div>}
    <nav className="tabs">{(["standings","draw","matches","players","rules"] as Tab[]).map((item)=><button key={item} className={tab===item?"active":""} onClick={()=>setTab(item)}>{tabLabels[item]}</button>)}</nav>
    <div className="content">{loading&&<div className="empty">読み込み中…</div>}
      {!loading&&tab==="standings"&&<Standings data={data} standings={standings} finalsReady={finalsReady}/>} 
      {!loading&&tab==="draw"&&<DrawPanel data={data} user={user} busy={busy} onCreateDraw={()=>{void createDraw();}} onCall={(number)=>{void mutate({action:"callMatch",calledMatchNumber:number});}} onOpenCall={openCallBoard} onResult={prepareResult}/>} 
      {!loading&&tab==="matches"&&<Matches data={data} user={user} onNew={()=>{if(user)setShowMatch(true);else setShowLogin(true);}} onDelete={(id)=>{void mutate({action:"deleteMatch",matchId:id});}}/>} 
      {!loading&&tab==="players"&&<Players data={data} standings={standings} user={user} name={name} setName={setName} onSubmit={addParticipant} onDelete={(id)=>{void mutate({action:"deleteParticipant",participantId:id});}}/>} 
      {!loading&&tab==="rules"&&<Rules/>}
    </div>
    {showMatch&&<Modal onClose={()=>setShowMatch(false)}><form onSubmit={saveMatch}><h2>試合結果を登録</h2><label className="field">試合区分<select value={stage} onChange={(event)=>setStage(event.target.value as Stage)}>{Object.entries(stageLabels).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></label><div className="result-rows">{rows.map((row,index)=><div className="result-row" key={index}><select value={row.placement} onChange={(event)=>updateRow(index,"placement",event.target.value)}>{[1,2,3,4].map((place)=><option key={place}>{place}</option>)}</select><select required value={row.participantId} onChange={(event)=>updateRow(index,"participantId",event.target.value)}><option value="">参加者</option>{data.participants.map((player)=><option key={player.id} value={player.id}>{player.name}</option>)}</select><input required type="number" min="0" placeholder="pt" value={row.points} onChange={(event)=>updateRow(index,"points",event.target.value)}/><input placeholder="曲名 [A/L]" value={row.selectedChart} onChange={(event)=>updateRow(index,"selectedChart",event.target.value)}/></div>)}</div><div className="modal-actions"><button type="button" onClick={()=>setShowMatch(false)}>キャンセル</button><button className="primary" disabled={busy}>保存</button></div></form></Modal>}
    {showTournament&&<Modal onClose={()=>setShowTournament(false)}><form onSubmit={createTournament}><h2>新しい大会</h2><label className="field">大会名<input required value={tournamentName} onChange={(event)=>setTournamentName(event.target.value)}/></label><label className="field">開催日<input type="date" value={eventDate} onChange={(event)=>setEventDate(event.target.value)}/></label><div className="modal-actions"><button type="button" onClick={()=>setShowTournament(false)}>キャンセル</button><button className="primary">作成</button></div></form></Modal>}
    {showLogin&&<Modal onClose={()=>setShowLogin(false)}><form onSubmit={login}><h2>運営ログイン</h2><label className="field">メールアドレス<input required type="email" value={email} onChange={(event)=>setEmail(event.target.value)}/></label><label className="field">パスワード<input required type="password" value={password} onChange={(event)=>setPassword(event.target.value)}/></label><div className="modal-actions"><button type="button" onClick={()=>setShowLogin(false)}>キャンセル</button><button className="primary">ログイン</button></div></form></Modal>}
  </main>;
}

function Standings({data,standings,finalsReady}:{data:TournamentData;standings:Standing[];finalsReady:boolean}){return <section><div className="section-heading"><div><p className="eyebrow">PRELIMINARY RANKING</p><h2>予選順位表</h2></div><span>同pt：1位数 → 4位数 → サドンデス</span></div><div className="ranking-table"><div className="ranking-head"><span>順位</span><span>プレイヤー</span><span>消化</span><span>1位</span><span>4位</span><span>合計pt</span></div>{standings.map((row,index)=><div className="ranking-row" key={row.id}><b>{index+1}</b><strong>{row.name}{row.suddenDeath&&<em className="sudden">サドンデス</em>}</strong><span>{row.games}/6</span><span>{row.firsts}</span><span>{row.fourths}</span><b>{row.points} pt</b></div>)}</div>{data.participants.length===12&&<div className="finals-grid">{(["king","middle","reverse"] as Stage[]).map((stage)=><article key={stage}><h3>{stageLabels[stage]}</h3>{finalGroup(stage,data,standings).map((row,index)=><div key={row.id}><b>{index+1}</b><span>{row.name}</span><strong>{row.finalPoints} pt</strong></div>)}{!finalsReady&&<small>全員完走・サドンデス確定後に組分け</small>}</article>)}</div>}</section>}

function DrawPanel({data,user,busy,onCreateDraw,onCall,onOpenCall,onResult}:{data:TournamentData;user:User|null;busy:boolean;onCreateDraw:()=>void;onCall:(n:number)=>void;onOpenCall:()=>void;onResult:(m:DrawMatch)=>void}){const schedule=data.tournament?.drawSchedule ?? [];const streamCounts=new Map<number,number>();schedule.forEach((match)=>match.streamParticipantIds.forEach((id)=>streamCounts.set(id,(streamCounts.get(id)??0)+1)));return <section><div className="section-heading"><div><p className="eyebrow">MATCH DRAW & CALL</p><h2>組み合わせ抽選・呼び出し</h2></div><div className="button-row"><button onClick={onOpenCall} disabled={!schedule.length}>呼び出し画面を開く</button>{user&&<button className="primary" onClick={onCreateDraw} disabled={busy||data.participants.length!==12}>{schedule.length?"再抽選":"18試合を抽選"}</button>}</div></div>{data.participants.length!==12&&<div className="notice">12名を登録すると抽選できます（現在 {data.participants.length}名）。</div>}{schedule.length>0&&<><div className="stream-summary">{data.participants.map((player)=><span key={player.id}>{player.name}<b>{streamCounts.get(player.id)??0}配信</b></span>)}</div><div className="draw-rounds">{[1,2,3,4,5,6].map((round)=><article key={round}><h3>ROUND {round}</h3>{schedule.filter((match)=>match.roundNumber===round).map((match)=><div className={data.tournament?.calledMatchNumber===match.matchNumber?"draw-match calling":"draw-match"} key={match.matchNumber}><b>第{match.matchNumber}試合</b><div>{match.participantIds.map((id)=><span key={id}>{playerName(data,id)}{match.streamParticipantIds.includes(id)&&<i>配信</i>}</span>)}</div>{user&&<aside><button onClick={()=>onCall(match.matchNumber)}>呼出</button><button onClick={()=>onResult(match)}>結果入力</button></aside>}</div>)}</article>)}</div></>}</section>}

function Matches({data,user,onNew,onDelete}:{data:TournamentData;user:User|null;onNew:()=>void;onDelete:(id:number)=>void}){return <section><div className="section-heading"><h2>試合履歴</h2><button className="primary" onClick={onNew}>新しい試合</button></div><div className="match-list">{[...data.matches].reverse().map((match)=><article key={match.id}><div className="match-title"><b>{stageLabels[match.stage]} #{match.roundNumber}</b>{user&&<button onClick={()=>window.confirm("削除しますか？")&&onDelete(match.id)}>削除</button>}</div>{data.results.filter((result)=>result.matchId===match.id).sort((a,b)=>a.placement-b.placement).map((result)=><div className="match-result" key={result.id}><b>{result.placement}位</b><span>{playerName(data,result.participantId)}</span><small>{result.selectedChart||"選曲未記録"}</small><strong>{result.points} pt</strong></div>)}</article>)}</div></section>}
function Players({data,standings,user,name,setName,onSubmit,onDelete}:{data:TournamentData;standings:Standing[];user:User|null;name:string;setName:(v:string)=>void;onSubmit:(e:FormEvent)=>void;onDelete:(id:number)=>void}){return <section><div className="section-heading"><h2>参加者登録</h2><b>{data.participants.length}/12</b></div><form className="entry-form" onSubmit={onSubmit}><input placeholder="DJ NAME" value={name} onChange={(event)=>setName(event.target.value)} disabled={!user||data.participants.length>=12}/><button className="primary" disabled={!user||data.participants.length>=12}>追加</button></form><div className="player-grid">{data.participants.map((player)=><article key={player.id}><i>{player.name.slice(0,1)}</i><strong>{player.name}</strong><span>{standings.find((row)=>row.id===player.id)?.games??0}試合</span>{user&&<button onClick={()=>window.confirm("削除しますか？")&&onDelete(player.id)}>×</button>}</article>)}</div></section>}
function Rules(){return <section><div className="section-heading"><h2>大会ルール</h2></div><div className="rules-grid"><article><b>01</b><h3>対戦形式</h3><p>12名・予選全18試合。1人6試合出場し、上位・中位・下位4名ずつで順位決定戦を行います。</p></article><article><b>02</b><h3>予選同点</h3><p>①1位回数、②4位回数の少なさ、③サドンデス（ALL ALPHABET / ANOTHERランダム1曲）の順。合意により☆12等へ変更可能です。</p></article><article><b>03</b><h3>選曲</h3><p>☆8〜12のANOTHER / LEGGENDARIA。順位決定戦までの6回の出場で、同じ譜面を2回以上選べません。</p></article><article><b>04</b><h3>版権曲</h3><p>収益化停止曲は選曲できません。判断に迷う場合は当日スタッフへご相談ください。</p></article><article><b>05</b><h3>配信</h3><p>各試合で2名を配信台へ割り当て、予選を通して1人3試合ずつ配信対象にします。</p></article><article><b>06</b><h3>順位決定戦</h3><p>順位決定戦で同ptの場合は、予選順位が上のプレイヤーを上位とします。</p></article></div></section>}
function Modal({children,onClose}:{children:React.ReactNode;onClose:()=>void}){return <div className="modal-backdrop" onMouseDown={(event)=>{if(event.target===event.currentTarget)onClose();}}><div className="modal"><button className="close" onClick={onClose}>×</button>{children}</div></div>}
