"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { loadTournament, mutateTournament } from "../src/data/tournamentRepository";
import { isSupabaseConfigured, supabase } from "../src/lib/supabase";
import { emptyTournamentData, type MutationPayload, type Participant, type Stage, type TournamentData } from "../src/types";

type Standing = Participant & { points: number; games: number; firsts: number; fourths: number; directPoints: number };
type DraftRow = { participantId: string; points: string; placement: string; selectedChart: string };

const stageLabels: Record<Stage, string> = { preliminary: "予選", king: "王決定戦", middle: "中位決定戦", reverse: "逆王決定戦" };
const initialRows: DraftRow[] = [1, 2, 3, 4].map((placement) => ({ participantId: "", points: "", placement: String(placement), selectedChart: "" }));

/** 予選結果から大会ルールに沿った順位表を生成します。 */
function preliminaryStandings(data: TournamentData): Standing[] {
  // 予選以外の順位決定戦は、予選ランキングの集計対象から除外します。
  const prelimIds = new Set(data.matches.filter((match) => match.stage === "preliminary").map((match) => match.id));
  const prelimResults = data.results.filter((result) => prelimIds.has(result.matchId));
  const base = data.participants.map((participant) => {
    const own = prelimResults.filter((result) => result.participantId === participant.id);
    return {
      ...participant,
      points: own.reduce((sum, result) => sum + result.points, 0),
      games: own.length,
      firsts: own.filter((result) => result.placement === 1).length,
      fourths: own.filter((result) => result.placement === 4).length,
      directPoints: 0,
    };
  });

  const pointGroups = new Map<number, number[]>();
  base.forEach((row) => pointGroups.set(row.points, [...(pointGroups.get(row.points) ?? []), row.id]));
  base.forEach((row) => {
    const rivals = new Set((pointGroups.get(row.points) ?? []).filter((id) => id !== row.id));
    if (rivals.size === 0) return;
    const sharedMatchIds = new Set<number>();
    prelimResults.filter((result) => rivals.has(result.participantId)).forEach((result) => sharedMatchIds.add(result.matchId));
    row.directPoints = prelimResults.filter((result) => result.participantId === row.id && sharedMatchIds.has(result.matchId)).reduce((sum, result) => sum + result.points, 0);
  });

  // 大会ルールどおり、合計pt→1位数→4位数→直接対決ptの順で比較します。
  return base.sort((a, b) => b.points - a.points || b.firsts - a.firsts || a.fourths - b.fourths || b.directPoints - a.directPoints || a.id - b.id);
}

/** 各順位決定戦を集計し、同点時は予選上位者を優先します。 */
function groupFinalStandings(stage: Stage, data: TournamentData, prelim: Standing[]) {
  const stageMatchIds = new Set(data.matches.filter((match) => match.stage === stage).map((match) => match.id));
  const finalResults = data.results.filter((result) => stageMatchIds.has(result.matchId));
  const eligible = stage === "king" ? prelim.slice(0, 4) : stage === "middle" ? prelim.slice(4, 8) : prelim.slice(8, 12);
  return eligible.map((player) => ({
    ...player,
    finalPoints: finalResults.filter((result) => result.participantId === player.id).reduce((sum, result) => sum + result.points, 0),
  })).sort((a, b) => b.finalPoints - a.finalPoints || prelim.findIndex((row) => row.id === a.id) - prelim.findIndex((row) => row.id === b.id));
}

/** 大会運営・公開順位表をまとめたメイン画面です。 */
export default function TournamentApp() {
  const [data, setData] = useState<TournamentData>(emptyTournamentData);
  const [tab, setTab] = useState<"standings" | "matches" | "players" | "rules">("standings");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [name, setName] = useState("");
  const [showMatchForm, setShowMatchForm] = useState(false);
  const [showTournamentForm, setShowTournamentForm] = useState(false);
  const [tournamentName, setTournamentName] = useState("");
  const [eventDate, setEventDate] = useState("");
  const [stage, setStage] = useState<Stage>("preliminary");
  const [rows, setRows] = useState<DraftRow[]>(initialRows);
  const [user, setUser] = useState<User | null>(null);
  const [showLoginForm, setShowLoginForm] = useState(false);
  const [loginEmail, setLoginEmail] = useState("");
  const [loginPassword, setLoginPassword] = useState("");

  /** 指定した大会をSupabaseから読み込み、画面全体を更新します。 */
  async function load(tournamentId?: number) {
    try {
      setLoading(true);
      setData(await loadTournament(tournamentId));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "大会データを読み込めませんでした。");
    } finally { setLoading(false); }
  }

  useEffect(() => {
    const timer = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!supabase) return;

    // 初回表示時のセッションと、その後のログイン・ログアウトを画面へ反映します。
    void supabase.auth.getSession().then(({ data: sessionData }) => {
      setUser(sessionData.session?.user ?? null);
    });
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
    });
    return () => listener.subscription.unsubscribe();
  }, []);

  /** ログイン状態を確認してから更新処理を実行します。 */
  async function mutate(payload: MutationPayload) {
    setBusy(true); setError("");
    try {
      if (!user) throw new Error("データを更新するには運営ログインが必要です。");
      setData(await mutateTournament(payload, data.tournament?.id));
      return true;
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "保存に失敗しました。");
      return false;
    } finally { setBusy(false); }
  }

  const standings = useMemo(() => preliminaryStandings(data), [data]);
  const completedPlayers = standings.filter((row) => row.games >= 6).length;
  const prelimMatches = data.matches.filter((match) => match.stage === "preliminary");
  const finalsReady = data.participants.length === 12 && completedPlayers === 12;
  const isPastTournament = Boolean(data.tournament && data.tournaments[0] && data.tournament.id !== data.tournaments[0].id);

  /** Supabase Authのメールアドレス・パスワードで運営者としてログインします。 */
  async function login(event: FormEvent) {
    event.preventDefault();
    if (!supabase) return;
    setBusy(true); setError("");
    const { error: loginError } = await supabase.auth.signInWithPassword({ email: loginEmail, password: loginPassword });
    setBusy(false);
    if (loginError) {
      setError("ログインできませんでした。メールアドレスとパスワードを確認してください。");
      return;
    }
    setLoginPassword("");
    setShowLoginForm(false);
  }

  async function logout() {
    if (!supabase) return;
    await supabase.auth.signOut();
  }

  /** 参加者追加フォームの送信処理です。 */
  async function addParticipant(event: FormEvent) {
    event.preventDefault();
    if (await mutate({ action: "addParticipant", name })) setName("");
  }

  /** 新しい大会を作成し、作成直後の大会へ表示を切り替えます。 */
  async function createTournament(event: FormEvent) {
    event.preventDefault();
    const ok = await mutate({ action: "createTournament", tournamentName, eventDate });
    if (ok) {
      setTournamentName("");
      setEventDate("");
      setShowTournamentForm(false);
      setTab("standings");
    }
  }

  /** 4人分の入力値をまとめて試合登録RPCへ渡します。 */
  async function saveMatch(event: FormEvent) {
    event.preventDefault();
    const ok = await mutate({
      action: "addMatch", stage,
      results: rows.map((row) => ({ participantId: Number(row.participantId), points: Number(row.points), placement: Number(row.placement), selectedChart: row.selectedChart })),
    });
    if (ok) { setRows(initialRows); setShowMatchForm(false); setTab("standings"); }
  }

  /** 試合入力表のうち、変更された1セルだけを更新します。 */
  function updateRow(index: number, field: keyof DraftRow, value: string) {
    setRows((current) => current.map((row, rowIndex) => rowIndex === index ? { ...row, [field]: value } : row));
  }

  const usedCharts = (participantId: number) => data.results.filter((result) => result.participantId === participantId && result.selectedChart).map((result) => result.selectedChart);

  return (
    <main>
      <header className="topbar">
        <div className="brand"><span className="brand-mark">王</span><div><strong>ARENA CROWN</strong><small>IIDX LOCAL TOURNAMENT</small></div></div>
        <div className="header-actions">
          <label className="tournament-switcher"><span>大会を切り替える</span><select value={data.tournament?.id ?? ""} onChange={(event) => { void load(Number(event.target.value)); }} aria-label="表示する大会"><option value="" disabled>大会を選択</option>{data.tournaments.map((item) => <option key={item.id} value={item.id}>{item.name}{item.eventDate ? `（${item.eventDate}）` : ""}</option>)}</select></label>
          <button className="secondary compact" onClick={() => user ? setShowTournamentForm(true) : setShowLoginForm(true)}>＋ 新しい大会</button>
          <button className="primary compact" onClick={() => user ? setShowMatchForm(true) : setShowLoginForm(true)} disabled={data.participants.length < 4}>＋ 試合結果</button>
          {user
            ? <button className="auth-button" onClick={() => { void logout(); }} title={user.email}>ログアウト</button>
            : <button className="auth-button" onClick={() => setShowLoginForm(true)}>運営ログイン</button>}
        </div>
      </header>

      <section className="hero">
        <div>
          <p className="eyebrow">{isPastTournament ? "PAST TOURNAMENT / ARCHIVE" : "CURRENT TOURNAMENT / 12 PLAYERS"}</p>
          <h1>{data.tournament?.name ?? "大会を作成"}<br /><span>{data.tournament?.eventDate || "大会コントロール"}</span></h1>
          <p className="hero-copy">予選6試合の進行から、王・中位・逆王決定戦まで。いまの順位と試合消化状況をリアルタイムに集計します。</p>
        </div>
        <div className="hero-status">
          <span className="live-dot" /> TOURNAMENT STATUS
          <strong>{finalsReady ? "順位決定戦" : data.participants.length < 12 ? "参加者受付中" : "予選進行中"}</strong>
          <div className="meter"><i style={{ width: `${Math.min(100, (standings.reduce((sum, row) => sum + Math.min(row.games, 6), 0) / 72) * 100)}%` }} /></div>
          <small>{standings.reduce((sum, row) => sum + Math.min(row.games, 6), 0)} / 72 PLAYER GAMES</small>
        </div>
      </section>

      <section className="metrics">
        <article><small>PLAYERS</small><strong>{data.participants.length}<em>/12</em></strong><span>登録済み参加者</span></article>
        <article><small>PRELIM MATCHES</small><strong>{prelimMatches.length}</strong><span>予選試合数</span></article>
        <article><small>6 GAMES DONE</small><strong>{completedPlayers}<em>/12</em></strong><span>予選完走者</span></article>
        <article className="accent"><small>NEXT PHASE</small><strong className="text-value">{finalsReady ? "決定戦" : "予選"}</strong><span>{finalsReady ? "組分け確定" : "6試合を目指す"}</span></article>
      </section>

      {error && <div className="error"><span>!</span>{error}<button onClick={() => setError("")}>×</button></div>}
      {!isSupabaseConfigured && <div className="error"><span>!</span>Supabaseの接続情報が未設定です。READMEの手順に従って環境変数を設定してください。</div>}
      {isSupabaseConfigured && !user && <div className="viewer-banner"><strong>閲覧モード</strong><span>順位と試合結果は閲覧できます。登録・編集は運営ログイン後に利用できます。</span><button onClick={() => setShowLoginForm(true)}>運営ログイン</button></div>}

      <nav className="tabs" aria-label="大会メニュー">
        <button className={tab === "standings" ? "active" : ""} onClick={() => setTab("standings")}>順位表</button>
        <button className={tab === "matches" ? "active" : ""} onClick={() => setTab("matches")}>試合履歴</button>
        <button className={tab === "players" ? "active" : ""} onClick={() => setTab("players")}>参加者</button>
        <button className={tab === "rules" ? "active" : ""} onClick={() => setTab("rules")}>大会ルール</button>
      </nav>

      <div className="content">
        {loading ? <div className="empty">大会データを読み込んでいます…</div> : null}

        {!loading && tab === "standings" && <section>
          <div className="section-heading"><div><p className="eyebrow">PRELIMINARY RANKING</p><h2>予選順位表</h2></div><span className="tie-note">同点時：1位数 → 4位数 → 直接対決pt</span></div>
          {standings.length === 0 ? <Empty title="参加者を登録して大会を始めよう" copy="「参加者」タブから最大12名を登録できます。" /> : <div className="ranking-table">
            <div className="ranking-head"><span>順位</span><span>プレイヤー</span><span>消化</span><span>1位</span><span>4位</span><span>直接</span><span>合計pt</span></div>
            {standings.map((row, index) => <div className={`ranking-row rank-${index + 1}`} key={row.id}>
              <span className="rank"><b>{index + 1}</b><small>{index < 4 ? "王" : index < 8 ? "中" : "逆"}</small></span>
              <span className="player"><i>{row.name.slice(0, 1).toUpperCase()}</i><strong>{row.name}</strong></span>
              <span className="games"><b>{row.games}</b>/6<div><i style={{ width: `${Math.min(100, row.games / 6 * 100)}%` }} /></div></span>
              <span>{row.firsts}</span><span>{row.fourths}</span><span>{row.directPoints}</span><span className="points">{row.points}<small> pt</small></span>
            </div>)}
          </div>}

          {data.participants.length === 12 && <div className="finals-grid">
            {(["king", "middle", "reverse"] as Stage[]).map((groupStage) => {
              const group = groupFinalStandings(groupStage, data, standings);
              return <article className={`final-card ${groupStage}`} key={groupStage}><p>{stageLabels[groupStage]}</p><h3>{groupStage === "king" ? "王の座を争う4名" : groupStage === "middle" ? "中位を決める4名" : "逆王を決める4名"}</h3>
                {group.map((player, index) => <div key={player.id}><b>{index + 1}</b><span>{player.name}</span><strong>{player.finalPoints} pt</strong></div>)}
                {!finalsReady && <small className="locked">全員が予選6試合を完了すると組分け確定</small>}
              </article>;
            })}
          </div>}
        </section>}

        {!loading && tab === "matches" && <section>
          <div className="section-heading"><div><p className="eyebrow">MATCH LOG</p><h2>試合履歴</h2></div><button className="primary" onClick={() => user ? setShowMatchForm(true) : setShowLoginForm(true)} disabled={data.participants.length < 4}>＋ 新しい試合</button></div>
          {data.matches.length === 0 ? <Empty title="まだ試合結果はありません" copy="4名の参加者を選び、順位と獲得ptを登録します。" /> : <div className="match-list">{[...data.matches].reverse().map((match) => <article key={match.id}>
            <div className="match-title"><span>{stageLabels[match.stage]} #{match.roundNumber}</span>{user && <button className="icon-button" onClick={() => { if (confirm("この試合結果を削除しますか？")) void mutate({ action: "deleteMatch", matchId: match.id }); }}>削除</button>}</div>
            <div className="match-results">{data.results.filter((result) => result.matchId === match.id).sort((a, b) => a.placement - b.placement).map((result) => <div key={result.id}><b>{result.placement}</b><span>{data.participants.find((player) => player.id === result.participantId)?.name}</span><small>{result.selectedChart || "選曲未記録"}</small><strong>{result.points} pt</strong></div>)}</div>
          </article>)}</div>}
        </section>}

        {!loading && tab === "players" && <section>
          <div className="section-heading"><div><p className="eyebrow">PLAYER ENTRY</p><h2>参加者登録</h2></div><span className="capacity">{data.participants.length} / 12</span></div>
          <form className="entry-form" onSubmit={addParticipant}><label><span>プレイヤー名</span><input value={name} onChange={(event) => setName(event.target.value)} placeholder="DJ NAME" maxLength={30} disabled={!user || data.participants.length >= 12} /></label><button className="primary" disabled={!user || busy || data.participants.length >= 12}>参加者を追加</button></form>
          <div className="player-grid">{data.participants.map((participant, index) => {
            const standing = standings.find((row) => row.id === participant.id);
            return <article key={participant.id}><i>{participant.name.slice(0, 1).toUpperCase()}</i><div><small>PLAYER {String(index + 1).padStart(2, "0")}</small><strong>{participant.name}</strong><span>{standing?.games ?? 0}試合 / {standing?.points ?? 0}pt</span></div>{user && <button className="icon-button" onClick={() => { if (confirm(`${participant.name} を削除しますか？`)) void mutate({ action: "deleteParticipant", participantId: participant.id }); }}>×</button>}</article>;
          })}</div>
        </section>}

        {!loading && tab === "rules" && <Rules />}
      </div>

      {showMatchForm && <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setShowMatchForm(false); }}>
        <form className="modal" onSubmit={saveMatch}>
          <div className="modal-head"><div><p className="eyebrow">RESULT ENTRY</p><h2>試合結果を登録</h2></div><button type="button" className="close" onClick={() => setShowMatchForm(false)}>×</button></div>
          <label className="stage-select"><span>試合区分</span><select value={stage} onChange={(event) => setStage(event.target.value as Stage)}><option value="preliminary">予選</option><option value="king">王決定戦</option><option value="middle">中位決定戦</option><option value="reverse">逆王決定戦</option></select></label>
          <div className="result-labels"><span>順位</span><span>プレイヤー</span><span>獲得pt</span><span>選曲譜面（任意）</span></div>
          <div className="result-rows">{rows.map((row, index) => {
            const duplicate = row.selectedChart && usedCharts(Number(row.participantId)).some((chart) => chart.trim().toLowerCase() === row.selectedChart.trim().toLowerCase());
            return <div className="result-row" key={index}><select value={row.placement} onChange={(event) => updateRow(index, "placement", event.target.value)} aria-label={`${index + 1}行目の順位`}>{[1,2,3,4].map((place) => <option key={place} value={place}>{place}位</option>)}</select><select required value={row.participantId} onChange={(event) => updateRow(index, "participantId", event.target.value)} aria-label={`${index + 1}行目の参加者`}><option value="">選択</option>{data.participants.map((participant) => <option key={participant.id} value={participant.id}>{participant.name}</option>)}</select><input required type="number" min="0" value={row.points} onChange={(event) => updateRow(index, "points", event.target.value)} placeholder="0" aria-label={`${index + 1}行目の獲得ポイント`} /><div><input value={row.selectedChart} onChange={(event) => updateRow(index, "selectedChart", event.target.value)} placeholder="曲名 [A/L]" aria-label={`${index + 1}行目の選曲譜面`} />{duplicate && <small className="warning">⚠ この譜面は登録済みです</small>}</div></div>;
          })}</div>
          <p className="form-help">順位は1〜4位を1人ずつ指定。獲得ptは大会で使用する値をそのまま入力してください。</p>
          <div className="modal-actions"><button type="button" className="secondary" onClick={() => setShowMatchForm(false)}>キャンセル</button><button className="primary" disabled={busy}>{busy ? "保存中…" : "結果を保存"}</button></div>
        </form>
      </div>}

      {showTournamentForm && <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setShowTournamentForm(false); }}>
        <form className="modal tournament-modal" onSubmit={createTournament}>
          <div className="modal-head"><div><p className="eyebrow">NEW TOURNAMENT</p><h2>新しい大会を作成</h2></div><button type="button" className="close" onClick={() => setShowTournamentForm(false)}>×</button></div>
          <p className="modal-copy">新しい大会を作成しても、現在の大会結果は過去大会として残ります。</p>
          <label className="field"><span>大会名</span><input required value={tournamentName} onChange={(event) => setTournamentName(event.target.value)} placeholder="例：第2回 IIDX 王決定戦" maxLength={60} /></label>
          <label className="field"><span>開催日（任意）</span><input type="date" value={eventDate} onChange={(event) => setEventDate(event.target.value)} /></label>
          <div className="modal-actions"><button type="button" className="secondary" onClick={() => setShowTournamentForm(false)}>キャンセル</button><button className="primary" disabled={busy}>{busy ? "作成中…" : "大会を作成"}</button></div>
        </form>
      </div>}

      {showLoginForm && <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setShowLoginForm(false); }}>
        <form className="modal tournament-modal" onSubmit={login}>
          <div className="modal-head"><div><p className="eyebrow">OPERATOR LOGIN</p><h2>運営ログイン</h2></div><button type="button" className="close" onClick={() => setShowLoginForm(false)}>×</button></div>
          <p className="modal-copy">Supabase Authに登録した運営者のメールアドレスとパスワードを入力してください。</p>
          <label className="field"><span>メールアドレス</span><input required type="email" autoComplete="username" value={loginEmail} onChange={(event) => setLoginEmail(event.target.value)} /></label>
          <label className="field"><span>パスワード</span><input required type="password" autoComplete="current-password" value={loginPassword} onChange={(event) => setLoginPassword(event.target.value)} /></label>
          <div className="modal-actions"><button type="button" className="secondary" onClick={() => setShowLoginForm(false)}>キャンセル</button><button className="primary" disabled={busy}>{busy ? "ログイン中…" : "ログイン"}</button></div>
        </form>
      </div>}
    </main>
  );
}

function Empty({ title, copy }: { title: string; copy: string }) {
  return <div className="empty"><span>王</span><h3>{title}</h3><p>{copy}</p></div>;
}

function Rules() {
  return <section><div className="section-heading"><div><p className="eyebrow">TOURNAMENT FORMAT</p><h2>大会ルール</h2></div></div><div className="rules-grid">
    <article><b>01</b><h3>12人総当たり型予選</h3><p>1人6試合。11人の対戦相手とそれぞれ1〜3回対戦し、アリーナptの合計を競います。</p></article>
    <article><b>02</b><h3>3つの順位決定戦</h3><p>予選上位4名は王決定戦、中位4名は中位決定戦、下位4名は逆王決定戦へ進みます。</p></article>
    <article><b>03</b><h3>選曲制限</h3><p>Lv8〜12のANOTHER / LEGGENDARIA譜面。予選から順位決定戦まで、同じ譜面は再選曲できません。</p></article>
    <article><b>04</b><h3>予選の同点処理</h3><p>①1位の数が多い方、②4位の数が少ない方、③直接対決での獲得ptが多い方の順で上位になります。</p></article>
    <article><b>05</b><h3>決定戦の同点処理</h3><p>順位決定戦で同ptの場合は、予選順位が上のプレイヤーをそのまま上位とします。</p></article>
    <article><b>06</b><h3>版権曲</h3><p>版権曲を選曲したい場合は、事前に大会運営へ相談してください。</p></article>
  </div></section>;
}
