import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import type { User } from "@supabase/supabase-js";
import ManualDrawEditor from "../src/components/ManualDrawEditor";
import { loadTournament, mutateTournament } from "../src/data/tournamentRepository";
import { generatePreliminaryDraw } from "../src/lib/draw";
import { buildFinalGroup, buildPreliminaryStandings, stageLabels, type Standing } from "../src/lib/standings";
import { isSupabaseConfigured, supabase } from "../src/lib/supabase";
import { emptyTournamentData, type DrawMatch, type Match, type MutationPayload, type Participant, type Stage, type TournamentData } from "../src/types";

type Tab = "standings" | "draw" | "matches" | "players" | "rules";
type DraftRow = { participantId: string; points: string; placement: string; selectedChart: string };

const tabLabels: Record<Tab, string> = {
  standings: "順位表", draw: "組み合わせ", matches: "試合結果", players: "参加者", rules: "大会ルール",
};

function createInitialResultRows(): DraftRow[] {
  return [1, 2, 3, 4].map((placement) => ({ participantId: "", points: "", placement: String(placement), selectedChart: "" }));
}

function playerName(data: TournamentData, participantId: number): string {
  const participant = data.participants.find((item) => item.id === participantId);
  if (!participant) return "未登録";
  return participant.name;
}

/**
 * 明示的にアーカイブ指定された大会、または現在大会より前に作成された大会を過去回と判定します。
 * 旧データにも互換性を持たせるため、isArchivedが未設定だった大会は作成順で補完します。
 */
function isPastTournament(data: TournamentData): boolean {
  if (!data.tournament) return false;
  if (data.tournament.isArchived) return true;
  const latestCurrentTournament = data.tournaments.find((tournament) => !tournament.isArchived);
  if (!latestCurrentTournament) return false;
  return latestCurrentTournament.id !== data.tournament.id;
}

/** 配信キャプチャ向けの静的表示です。初回読込後は自動でデータを更新しません。 */
function CallBoard({ data }: { data: TournamentData }) {
  let calledMatchNumber = 1;
  if (data.tournament?.calledMatchNumber) calledMatchNumber = data.tournament.calledMatchNumber;
  const currentMatch = data.tournament?.drawSchedule.find((match) => match.matchNumber === calledMatchNumber);

  if (!currentMatch) {
    return <main className="call-board call-board-empty"><h1>表示する試合が選択されていません</h1></main>;
  }

  return (
    <main className="call-board">
      <div className="call-players">
        {currentMatch.participantIds.map((participantId, index) => {
          const participant = data.participants.find((item) => item.id === participantId);
          const slotName = ["A", "B", "C", "D"][index];
          return (
            <article key={participantId}>
              <span className="call-slot">{slotName}</span>
              {participant?.imageUrl
                ? <img src={participant.imageUrl} alt={`${participant.name} 選手画像`} />
                : <div className="call-image-placeholder" aria-label="選手画像未登録">{participant?.name.slice(0, 1).toUpperCase() ?? "?"}</div>}
              <p>{participant?.title || "　"}</p>
              <strong>{participant?.name ?? "未登録"}</strong>
            </article>
          );
        })}
      </div>
    </main>
  );
}

/** 大会管理アプリ全体の状態と画面切り替えを管理します。 */
export default function TournamentApp() {
  const queryParameters = new URLSearchParams(window.location.search);
  const callMode = queryParameters.get("call") === "1";
  const tournamentParameter = Number(queryParameters.get("tournament"));
  let requestedTournamentId: number | undefined;
  if (tournamentParameter > 0) requestedTournamentId = tournamentParameter;

  const [data, setData] = useState<TournamentData>(emptyTournamentData);
  const [tab, setTab] = useState<Tab>("standings");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [user, setUser] = useState<User | null>(null);
  const [archiveEditMode, setArchiveEditMode] = useState(false);
  const [showLogin, setShowLogin] = useState(false);
  const [loginEmail, setLoginEmail] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [showTournamentForm, setShowTournamentForm] = useState(false);
  const [tournamentName, setTournamentName] = useState("");
  const [eventDate, setEventDate] = useState("");
  const [createAsArchive, setCreateAsArchive] = useState(false);
  const [showMatchForm, setShowMatchForm] = useState(false);
  const [editingMatchId, setEditingMatchId] = useState<number | null>(null);
  const [stage, setStage] = useState<Stage>("preliminary");
  const [resultRows, setResultRows] = useState<DraftRow[]>(createInitialResultRows);

  async function load(tournamentId?: number) {
    try {
      setLoading(true);
      setData(await loadTournament(tournamentId));
      setError("");
    } catch (caught) {
      if (caught instanceof Error) setError(caught.message);
      else setError("大会データの読み込みに失敗しました。");
    } finally { setLoading(false); }
  }

  useEffect(() => { void load(requestedTournamentId); }, []);

  // OBSで常時表示する画面はポーリングせず、表示対象のDB更新が届いたときだけ再取得します。
  useEffect(() => {
    const tournamentId = data.tournament?.id;
    const realtimeClient = supabase;
    if (!callMode || !realtimeClient || !tournamentId) return;

    async function refreshCallBoard() {
      try {
        // 初回読込後はloadingを変更せず、配信映像を空画面へ切り替えずに差し替えます。
        setData(await loadTournament(tournamentId));
      } catch (caught) {
        if (caught instanceof Error) setError(caught.message);
        else setError("配信用表示の更新に失敗しました。");
      }
    }

    const channel = realtimeClient
      .channel(`call-board-${tournamentId}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "tournaments",
          filter: `id=eq.${tournamentId}`,
        },
        () => { void refreshCallBoard(); },
      )
      .subscribe();

    return () => { void realtimeClient.removeChannel(channel); };
  }, [callMode, data.tournament?.id]);

  useEffect(() => {
    if (!supabase) return;
    void supabase.auth.getSession().then(({ data: sessionData }) => setUser(sessionData.session?.user ?? null));
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => setUser(session?.user ?? null));
    return () => listener.subscription.unsubscribe();
  }, []);

  /** 認証確認・エラー表示・再読込を共通化した更新処理です。 */
  async function mutate(payload: MutationPayload): Promise<boolean> {
    setBusy(true); setError("");
    try {
      if (!user) throw new Error("データを更新するには運営ログインが必要です。");
      setData(await mutateTournament(payload, data.tournament?.id));
      return true;
    } catch (caught) {
      if (caught instanceof Error) setError(caught.message);
      else setError("保存に失敗しました。");
      return false;
    } finally { setBusy(false); }
  }

  const standings = useMemo(() => buildPreliminaryStandings(data), [data]);
  const pastTournament = isPastTournament(data);
  const canEdit = user !== null && (!pastTournament || archiveEditMode);
  const chartInputEnabled = pastTournament && archiveEditMode;
  const preliminaryMatches = data.matches.filter((match) => match.stage === "preliminary");
  const completedPlayerCount = standings.filter((standing) => standing.games >= 6).length;
  const finalsReady = data.participants.length === 12 && completedPlayerCount === 12 && !standings.some((standing) => standing.suddenDeath);

  if (callMode) {
    if (loading) return <main className="call-board"><h1>読み込み中です…</h1></main>;
    return <CallBoard data={data} />;
  }

  async function changeTournament(tournamentId: number) {
    setArchiveEditMode(false); setTab("standings"); await load(tournamentId);
  }

  async function login(event: FormEvent) {
    event.preventDefault();
    if (!supabase) return;
    setBusy(true); setError("");
    const response = await supabase.auth.signInWithPassword({ email: loginEmail, password: loginPassword });
    setBusy(false);
    if (response.error) { setError("ログインできませんでした。メールアドレスとパスワードを確認してください。"); return; }
    setLoginPassword(""); setShowLogin(false);
  }

  async function createTournament(event: FormEvent) {
    event.preventDefault();
    const saved = await mutate({ action: "createTournament", tournamentName, eventDate, isArchived: createAsArchive });
    if (!saved) return;
    setShowTournamentForm(false); setTournamentName(""); setEventDate("");
    setArchiveEditMode(createAsArchive); setCreateAsArchive(false);
    if (createAsArchive) setTab("players"); else setTab("standings");
  }

  function updateResultRow(index: number, field: keyof DraftRow, value: string) {
    setResultRows((currentRows) => currentRows.map((row, rowIndex) => rowIndex === index ? { ...row, [field]: value } : row));
  }

  async function saveMatch(event: FormEvent) {
    event.preventDefault();
    const matchAction = editingMatchId === null ? "addMatch" : "updateMatch";
    const saved = await mutate({
      action: matchAction,
      matchId: editingMatchId ?? undefined,
      stage,
      results: resultRows.map((row) => ({
        participantId: Number(row.participantId),
        points: Number(row.points),
        placement: Number(row.placement),
        // 通常運営では、以前の入力状態が残っていても楽曲情報を保存しません。
        selectedChart: chartInputEnabled ? row.selectedChart : "",
      })),
    });
    if (!saved) return;
    const nextTab = editingMatchId === null ? "standings" : "matches";
    setEditingMatchId(null);
    setResultRows(createInitialResultRows());
    setShowMatchForm(false);
    setTab(nextTab);
  }

  function openNewResult() {
    setEditingMatchId(null);
    setStage("preliminary");
    setResultRows(createInitialResultRows());
    setShowMatchForm(true);
  }

  function closeResultForm() {
    setEditingMatchId(null);
    setResultRows(createInitialResultRows());
    setShowMatchForm(false);
  }

  /** 組み合わせ表から結果入力を開く場合は、4名を入力済みの状態にします。 */
  function prepareResultEntry(match: DrawMatch) {
    setEditingMatchId(null);
    setStage("preliminary");
    setResultRows(match.participantIds.map((participantId, index) => ({ participantId: String(participantId), points: "", placement: String(index + 1), selectedChart: "" })));
    setShowMatchForm(true);
  }

  /** 登録済みの4名分を入力欄へ戻し、同じ試合IDのまま修正できるようにします。 */
  function prepareMatchEdit(match: Match) {
    const existingResults = data.results
      .filter((result) => result.matchId === match.id)
      .sort((left, right) => {
        if (left.placement !== right.placement) return left.placement - right.placement;
        return left.id - right.id;
      });
    if (existingResults.length !== 4) {
      setError("この試合は4名分の結果が揃っていないため編集できません。");
      return;
    }

    setEditingMatchId(match.id);
    setStage(match.stage);
    setResultRows(existingResults.map((result) => ({
      participantId: String(result.participantId),
      points: String(result.points),
      placement: String(result.placement),
      selectedChart: result.selectedChart,
    })));
    setShowMatchForm(true);
  }

  async function createAutomaticDraw() {
    if (data.tournament?.drawSchedule.length && !window.confirm("現在の組み合わせを破棄して再抽選しますか？")) return;
    try { await mutate({ action: "saveDraw", drawSchedule: generatePreliminaryDraw(data.participants) }); }
    catch (caught) { if (caught instanceof Error) setError(caught.message); else setError("組み合わせ抽選に失敗しました。"); }
  }

  function openCallBoard() {
    if (!data.tournament) return;
    window.open(`${window.location.pathname}?call=1&tournament=${data.tournament.id}`, "iidx-call-board");
  }

  return (
    <main>
      <Header data={data} user={user} canEdit={canEdit} onTournamentChange={(id) => void changeTournament(id)} onNewTournament={() => user ? setShowTournamentForm(true) : setShowLogin(true)} onNewResult={() => canEdit ? openNewResult() : setShowLogin(true)} onLogin={() => setShowLogin(true)} onLogout={() => void supabase?.auth.signOut()} />
      <Hero data={data} pastTournament={pastTournament} preliminaryMatchCount={preliminaryMatches.length} completedPlayerCount={completedPlayerCount} />

      {error && <div className="error" role="alert"><span>{error}</span><button onClick={() => setError("")} aria-label="エラーを閉じる">×</button></div>}
      {!isSupabaseConfigured && <div className="error">Supabaseの接続情報が未設定です。</div>}
      {pastTournament && <ArchiveBanner user={user} editMode={archiveEditMode} onEnableEdit={() => user ? setArchiveEditMode(true) : setShowLogin(true)} onDisableEdit={() => setArchiveEditMode(false)} />}

      <nav className="tabs" aria-label="大会メニュー">
        {(Object.keys(tabLabels) as Tab[]).map((item) => <button key={item} className={tab === item ? "active" : ""} onClick={() => setTab(item)}>{tabLabels[item]}</button>)}
      </nav>

      <div className="content">
        {loading && <div className="empty">大会データを読み込んでいます…</div>}
        {!loading && tab === "standings" && <StandingsPanel data={data} standings={standings} finalsReady={finalsReady} />}
        {!loading && tab === "draw" && <DrawPanel data={data} pastTournament={pastTournament} canEdit={canEdit} busy={busy} onAutomaticDraw={() => void createAutomaticDraw()} onSaveManualDraw={(schedule) => mutate({ action: "saveDraw", drawSchedule: schedule })} onCall={(matchNumber) => void mutate({ action: "callMatch", calledMatchNumber: matchNumber })} onOpenCallBoard={openCallBoard} onResultEntry={prepareResultEntry} />}
        {!loading && tab === "matches" && <MatchesPanel data={data} canEdit={canEdit} onNew={openNewResult} onEdit={prepareMatchEdit} onDelete={(matchId) => void mutate({ action: "deleteMatch", matchId })} />}
        {!loading && tab === "players" && <PlayersPanel data={data} standings={standings} canEdit={canEdit} busy={busy} onAdd={(name, title, imageFile) => mutate({ action: "addParticipant", name, title, imageFile })} onUpdate={(participantId, name, title, imageFile, removeImage) => mutate({ action: "updateParticipant", participantId, name, title, imageFile, removeImage })} onDelete={(participantId) => void mutate({ action: "deleteParticipant", participantId })} />}
        {!loading && tab === "rules" && <RulesPanel />}
      </div>

      {showMatchForm && <ResultModal data={data} rows={resultRows} stage={stage} busy={busy} editing={editingMatchId !== null} showChartInput={chartInputEnabled} onStageChange={setStage} onRowChange={updateResultRow} onSubmit={saveMatch} onClose={closeResultForm} />}
      {showTournamentForm && <TournamentModal name={tournamentName} eventDate={eventDate} createAsArchive={createAsArchive} busy={busy} setName={setTournamentName} setEventDate={setEventDate} setCreateAsArchive={setCreateAsArchive} onSubmit={createTournament} onClose={() => setShowTournamentForm(false)} />}
      {showLogin && <LoginModal email={loginEmail} password={loginPassword} busy={busy} setEmail={setLoginEmail} setPassword={setLoginPassword} onSubmit={login} onClose={() => setShowLogin(false)} />}
    </main>
  );
}

type HeaderProps = { data: TournamentData; user: User | null; canEdit: boolean; onTournamentChange: (id: number) => void; onNewTournament: () => void; onNewResult: () => void; onLogin: () => void; onLogout: () => void };

function Header({ data, user, canEdit, onTournamentChange, onNewTournament, onNewResult, onLogin, onLogout }: HeaderProps) {
  return (
    <header className="topbar">
      <div className="brand"><span>王</span><div><strong>IIDX 王決定戦</strong><small>大会運営・集計システム</small></div></div>
      <div className="header-actions">
        <label className="tournament-switcher"><span>表示する大会</span><select value={data.tournament?.id ?? ""} onChange={(event) => onTournamentChange(Number(event.target.value))}>{data.tournaments.map((tournament) => <option key={tournament.id} value={tournament.id}>{tournament.name}{tournament.isArchived ? "（過去回）" : ""}</option>)}</select></label>
        <button className="secondary" onClick={onNewTournament}>大会を追加</button>
        <button className="primary" onClick={onNewResult} disabled={!canEdit || data.participants.length < 4}>試合結果を入力</button>
        {user && <button className="auth-button" onClick={onLogout}>ログアウト</button>}
        {!user && <button className="auth-button" onClick={onLogin}>運営ログイン</button>}
      </div>
    </header>
  );
}

function Hero({ data, pastTournament, preliminaryMatchCount, completedPlayerCount }: { data: TournamentData; pastTournament: boolean; preliminaryMatchCount: number; completedPlayerCount: number }) {
  let statusLabel = "現在大会";
  if (pastTournament) statusLabel = "過去大会の記録";
  return <section className="hero"><div><p className="eyebrow">{statusLabel}</p><h1>{data.tournament?.name ?? "大会を登録してください"}</h1><p className="hero-description">{data.tournament?.eventDate || "開催日未登録"}　／　参加者・組み合わせ・試合結果を一つの画面で管理します。</p></div><div className="hero-status"><span>予選の進行状況</span><strong>{preliminaryMatchCount} / 18試合</strong><div className="progress-track"><i style={{ width: `${Math.min(100, preliminaryMatchCount / 18 * 100)}%` }} /></div><small>{completedPlayerCount} / 12名が6試合完了</small></div></section>;
}

function ArchiveBanner({ user, editMode, onEnableEdit, onDisableEdit }: { user: User | null; editMode: boolean; onEnableEdit: () => void; onDisableEdit: () => void }) {
  return <section className={editMode ? "archive-banner editing" : "archive-banner"}><div><strong>{editMode ? "過去回を編集中です" : "過去回を閲覧しています"}</strong><p>{editMode ? "参加者、組み合わせ、試合結果を登録・修正できます。作業後は編集モードを終了してください。" : "誤操作を防ぐため、過去回は通常は閲覧専用です。"}</p></div>{!editMode && <button className="primary" onClick={onEnableEdit}>{user ? "過去回を編集" : "ログインして編集"}</button>}{editMode && <button onClick={onDisableEdit}>編集モードを終了</button>}</section>;
}

function StandingsPanel({ data, standings, finalsReady }: { data: TournamentData; standings: Standing[]; finalsReady: boolean }) {
  return <section><div className="section-heading"><div><p className="eyebrow">予選集計</p><h2>予選順位表</h2></div><span>同点時：1位回数 → 4位回数の少なさ → サドンデス</span></div>{standings.length === 0 && <Empty message="参加者を登録すると順位表が表示されます。" />}{standings.length > 0 && <div className="ranking-table"><div className="ranking-head"><span>順位</span><span>プレイヤー</span><span>消化</span><span>1位</span><span>4位</span><span>合計pt</span></div>{standings.map((standing, index) => <div className="ranking-row" key={standing.id}><b>{index + 1}</b><strong>{standing.name}{standing.suddenDeath && <em className="sudden">サドンデス対象</em>}</strong><span>{standing.games} / 6</span><span>{standing.firsts}</span><span>{standing.fourths}</span><b className="point-value">{standing.points} pt</b></div>)}</div>}{data.participants.length === 12 && <div className="finals-grid">{(["king", "middle", "reverse"] as Stage[]).map((finalStage) => <article key={finalStage}><h3>{stageLabels[finalStage]}</h3>{buildFinalGroup(finalStage, data, standings).map((standing, index) => <div key={standing.id}><b>{index + 1}</b><span>{standing.name}</span><strong>{standing.finalPoints} pt</strong></div>)}{!finalsReady && <small>全員完走・サドンデス確定後に組分けします。</small>}</article>)}</div>}</section>;
}

type DrawPanelProps = { data: TournamentData; pastTournament: boolean; canEdit: boolean; busy: boolean; onAutomaticDraw: () => void; onSaveManualDraw: (schedule: DrawMatch[]) => Promise<boolean>; onCall: (matchNumber: number) => void; onOpenCallBoard: () => void; onResultEntry: (match: DrawMatch) => void };

function DrawPanel({ data, pastTournament, canEdit, busy, onAutomaticDraw, onSaveManualDraw, onCall, onOpenCallBoard, onResultEntry }: DrawPanelProps) {
  const schedule = data.tournament?.drawSchedule ?? [];
  const streamCounts = new Map<number, number>();
  schedule.forEach((match) => match.streamParticipantIds.forEach((id) => streamCounts.set(id, (streamCounts.get(id) ?? 0) + 1)));
  const roundNumbers = [...new Set(schedule.map((match) => match.roundNumber))].sort((left, right) => left - right);

  return <section><div className="section-heading"><div><p className="eyebrow">対戦管理</p><h2>組み合わせ</h2></div><div className="button-row">{!pastTournament && <button onClick={onOpenCallBoard} disabled={schedule.length === 0}>配信用表示を開く</button>}{!pastTournament && canEdit && <button className="primary" onClick={onAutomaticDraw} disabled={busy || data.participants.length !== 12}>{schedule.length > 0 ? "組み合わせを再抽選" : "18試合を自動抽選"}</button>}</div></div>{!pastTournament && data.participants.length !== 12 && <div className="notice">12名を登録すると自動抽選できます。現在は{data.participants.length}名です。</div>}{pastTournament && <ManualDrawEditor participants={data.participants} schedule={schedule} disabled={!canEdit || busy} onSave={onSaveManualDraw} />}{schedule.length > 0 && <><div className="stream-summary">{data.participants.map((participant) => <span key={participant.id}>{participant.name}<b>{streamCounts.get(participant.id) ?? 0}回配信</b></span>)}</div><div className="draw-rounds">{roundNumbers.map((roundNumber) => <article key={roundNumber}><h3>ラウンド {roundNumber}</h3>{schedule.filter((match) => match.roundNumber === roundNumber).sort((left, right) => left.matchNumber - right.matchNumber).map((match) => { let className = "draw-match"; if (data.tournament?.calledMatchNumber === match.matchNumber) className += " calling"; return <div className={className} key={match.matchNumber}><div className="draw-match-title"><strong>第{match.matchNumber}試合</strong><span>台番号 {match.tableNumber}</span></div><div className="draw-player-list">{match.participantIds.map((id) => <span key={id}>{playerName(data, id)}{match.streamParticipantIds.includes(id) && <i>配信</i>}</span>)}</div>{canEdit && <div className="row-actions">{!pastTournament && <button onClick={() => onCall(match.matchNumber)}>表示対象にする</button>}<button onClick={() => onResultEntry(match)}>この試合の結果を入力</button></div>}</div>; })}</article>)}</div></>}</section>;
}

type MatchesPanelProps = {
  data: TournamentData;
  canEdit: boolean;
  onNew: () => void;
  onEdit: (match: Match) => void;
  onDelete: (matchId: number) => void;
};

function MatchesPanel({ data, canEdit, onNew, onEdit, onDelete }: MatchesPanelProps) {
  return (
    <section>
      <div className="section-heading">
        <div><p className="eyebrow">登録済みデータ</p><h2>試合結果</h2></div>
        {canEdit && <button className="primary" onClick={onNew}>試合結果を追加</button>}
      </div>
      {data.matches.length === 0 && <Empty message="登録済みの試合結果はありません。" />}
      <div className="match-list">
        {[...data.matches].reverse().map((match) => (
          <article key={match.id}>
            <div className="match-title">
              <strong>{stageLabels[match.stage]} 第{match.roundNumber}試合</strong>
              {canEdit && (
                <div className="match-actions">
                  <button onClick={() => onEdit(match)}>編集</button>
                  <button className="danger-button" onClick={() => window.confirm("この試合結果を削除しますか？") && onDelete(match.id)}>削除</button>
                </div>
              )}
            </div>
            {data.results
              .filter((result) => result.matchId === match.id)
              .sort((left, right) => left.placement - right.placement)
              .map((result) => (
                <div className="match-result" key={result.id}>
                  <b>{result.placement}位</b>
                  <span>{playerName(data, result.participantId)}</span>
                  <small>{result.selectedChart || "選曲未記録"}</small>
                  <strong>{result.points} pt</strong>
                </div>
              ))}
          </article>
        ))}
      </div>
    </section>
  );
}

type PlayersPanelProps = {
  data: TournamentData;
  standings: Standing[];
  canEdit: boolean;
  busy: boolean;
  onAdd: (name: string, title: string, imageFile?: File) => Promise<boolean>;
  onUpdate: (participantId: number, name: string, title: string, imageFile: File | undefined, removeImage: boolean) => Promise<boolean>;
  onDelete: (participantId: number) => void;
};

function PlayersPanel({ data, standings, canEdit, busy, onAdd, onUpdate, onDelete }: PlayersPanelProps) {
  const [name, setName] = useState("");
  const [title, setTitle] = useState("");
  const [imageFile, setImageFile] = useState<File>();
  const [imageInputKey, setImageInputKey] = useState(0);
  const [editingParticipant, setEditingParticipant] = useState<Participant | null>(null);
  const [editName, setEditName] = useState("");
  const [editTitle, setEditTitle] = useState("");
  const [editImageFile, setEditImageFile] = useState<File>();
  const [removeImage, setRemoveImage] = useState(false);

  async function addParticipant(event: FormEvent) {
    event.preventDefault();
    const saved = await onAdd(name, title, imageFile);
    if (!saved) return;
    setName("");
    setTitle("");
    setImageFile(undefined);
    setImageInputKey((currentKey) => currentKey + 1);
  }

  function startEditing(participant: Participant) {
    setEditingParticipant(participant);
    setEditName(participant.name);
    setEditTitle(participant.title);
    setEditImageFile(undefined);
    setRemoveImage(false);
  }

  async function updateParticipant(event: FormEvent) {
    event.preventDefault();
    if (!editingParticipant) return;
    const saved = await onUpdate(editingParticipant.id, editName, editTitle, editImageFile, removeImage);
    if (saved) setEditingParticipant(null);
  }

  return (
    <section>
      <div className="section-heading">
        <div><p className="eyebrow">エントリー</p><h2>参加者</h2></div>
        <strong>{data.participants.length} / 12名</strong>
      </div>

      {canEdit && (
        <form className="entry-form participant-entry-form" onSubmit={addParticipant}>
          <label>
            <span>プレイヤー名</span>
            <input required value={name} onChange={(event) => setName(event.target.value)} placeholder="DJ NAME" maxLength={30} disabled={busy || data.participants.length >= 12} />
          </label>
          <label>
            <span>二つ名</span>
            <input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="例：音速の挑戦者" maxLength={80} disabled={busy || data.participants.length >= 12} />
          </label>
          <label>
            <span>選手画像</span>
            <input key={imageInputKey} type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => setImageFile(event.target.files?.[0])} disabled={busy || data.participants.length >= 12} />
          </label>
          <button className="primary" disabled={busy || data.participants.length >= 12}>参加者を追加</button>
        </form>
      )}
      {canEdit && <p className="form-help player-image-help">選手画像はJPEG・PNG・WebP形式、5MB以下で登録してください。</p>}

      <div className="player-grid">
        {data.participants.map((participant) => {
          const standing = standings.find((item) => item.id === participant.id);
          return (
            <article key={participant.id}>
              {participant.imageUrl
                ? <img src={participant.imageUrl} alt={`${participant.name} 選手画像`} />
                : <i>{participant.name.slice(0, 1).toUpperCase()}</i>}
              <div>
                {participant.title && <small>{participant.title}</small>}
                <strong>{participant.name}</strong>
                <span>{standing?.games ?? 0}試合・{standing?.points ?? 0}pt</span>
              </div>
              {canEdit && (
                <div className="player-actions">
                  <button onClick={() => startEditing(participant)}>編集</button>
                  <button className="danger-button" onClick={() => window.confirm(`${participant.name}を削除しますか？`) && onDelete(participant.id)}>削除</button>
                </div>
              )}
            </article>
          );
        })}
      </div>

      {editingParticipant && (
        <Modal onClose={() => setEditingParticipant(null)}>
          <form onSubmit={updateParticipant}>
            <p className="dialog-kicker">参加者プロフィール</p>
            <h2>{editingParticipant.name}を編集</h2>
            <label className="field">
              <span>プレイヤー名</span>
              <input required value={editName} onChange={(event) => setEditName(event.target.value)} maxLength={30} />
            </label>
            <label className="field">
              <span>二つ名</span>
              <input value={editTitle} onChange={(event) => setEditTitle(event.target.value)} maxLength={80} placeholder="例：音速の挑戦者" />
            </label>
            <label className="field">
              <span>選手画像を差し替える</span>
              <input type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => { setEditImageFile(event.target.files?.[0]); setRemoveImage(false); }} />
            </label>
            {editingParticipant.imageUrl && !editImageFile && (
              <label className="remove-image-checkbox">
                <input type="checkbox" checked={removeImage} onChange={(event) => setRemoveImage(event.target.checked)} />
                <span>現在の選手画像を削除する</span>
              </label>
            )}
            <div className="modal-actions">
              <button type="button" onClick={() => setEditingParticipant(null)}>キャンセル</button>
              <button className="primary" disabled={busy}>変更を保存</button>
            </div>
          </form>
        </Modal>
      )}
    </section>
  );
}

function RulesPanel() {
  return <section><div className="section-heading"><div><p className="eyebrow">大会規定</p><h2>大会ルール</h2></div></div><div className="rules-grid"><article><b>01</b><h3>対戦形式</h3><p>12名で予選全18試合を実施します。1人6試合出場し、上位・中位・下位4名ずつで順位決定戦を行います。</p></article><article><b>02</b><h3>予選同点</h3><p>1位回数、4位回数の少なさ、サドンデスの順で順位を決定します。サドンデスの条件は当日の合意により変更できます。</p></article><article><b>03</b><h3>選曲</h3><p>☆8～12のANOTHER・LEGGENDARIAが対象です。同じ譜面を2回以上選曲することはできません。</p></article><article><b>04</b><h3>版権曲</h3><p>収益化停止曲は選曲できません。判断に迷う場合は当日スタッフへご相談ください。</p></article><article><b>05</b><h3>配信台</h3><p>各試合で2名を配信台へ割り当て、予選を通して1人3試合ずつ配信対象にします。</p></article><article><b>06</b><h3>順位決定戦</h3><p>順位決定戦で同ptの場合は、予選順位が上のプレイヤーを上位とします。</p></article></div></section>;
}

type ResultModalProps = {
  data: TournamentData;
  rows: DraftRow[];
  stage: Stage;
  busy: boolean;
  editing: boolean;
  showChartInput: boolean;
  onStageChange: (stage: Stage) => void;
  onRowChange: (index: number, field: keyof DraftRow, value: string) => void;
  onSubmit: (event: FormEvent) => void;
  onClose: () => void;
};

function ResultModal({ data, rows, stage, busy, editing, showChartInput, onStageChange, onRowChange, onSubmit, onClose }: ResultModalProps) {
  return (
    <Modal onClose={onClose}>
      <form onSubmit={onSubmit}>
        <p className="dialog-kicker">試合データ</p>
        <h2>{editing ? "試合結果を編集" : "試合結果を入力"}</h2>
        <label className="field">
          <span>試合区分</span>
          <select value={stage} onChange={(event) => onStageChange(event.target.value as Stage)}>
            {Object.entries(stageLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </label>
        <p className="form-help">同率だった場合は、複数の参加者に同じ順位を設定できます。</p>
        <div className="result-rows">
          {rows.map((row, index) => {
            // 選曲履歴は過去資料の保存用途に限定し、通常運営では入力項目自体を表示しません。
            const usedCharts = data.results
              .filter((result) => result.participantId === Number(row.participantId))
              .map((result) => result.selectedChart.trim().toLowerCase());
            const normalizedChart = row.selectedChart.trim().toLowerCase();
            const duplicateChart = normalizedChart.length > 0 && usedCharts.includes(normalizedChart);

            return (
              <div className={showChartInput ? "result-row" : "result-row result-row-without-chart"} key={index}>
                <label>
                  <span>順位（同率可）</span>
                  <select value={row.placement} onChange={(event) => onRowChange(index, "placement", event.target.value)}>
                    {[1, 2, 3, 4].map((place) => <option key={place} value={place}>{place}位</option>)}
                  </select>
                </label>
                <label>
                  <span>参加者</span>
                  <select required value={row.participantId} onChange={(event) => onRowChange(index, "participantId", event.target.value)}>
                    <option value="">選択してください</option>
                    {data.participants.map((participant) => <option key={participant.id} value={participant.id}>{participant.name}</option>)}
                  </select>
                </label>
                <label>
                  <span>獲得pt</span>
                  <input required type="number" min="0" value={row.points} onChange={(event) => onRowChange(index, "points", event.target.value)} />
                </label>
                {showChartInput && (
                  <label>
                    <span>選曲譜面</span>
                    <input value={row.selectedChart} onChange={(event) => onRowChange(index, "selectedChart", event.target.value)} placeholder="曲名 [A/L]" />
                    {duplicateChart && <small className="field-warning">この譜面は登録済みです。</small>}
                  </label>
                )}
              </div>
            );
          })}
        </div>
        <div className="modal-actions">
          <button type="button" onClick={onClose}>キャンセル</button>
          <button className="primary" disabled={busy}>{editing ? "変更を保存" : "結果を保存"}</button>
        </div>
      </form>
    </Modal>
  );
}

function TournamentModal({ name, eventDate, createAsArchive, busy, setName, setEventDate, setCreateAsArchive, onSubmit, onClose }: { name: string; eventDate: string; createAsArchive: boolean; busy: boolean; setName: (value: string) => void; setEventDate: (value: string) => void; setCreateAsArchive: (value: boolean) => void; onSubmit: (event: FormEvent) => void; onClose: () => void }) {
  return <Modal onClose={onClose}><form onSubmit={onSubmit}><p className="dialog-kicker">大会データの作成</p><h2>新しい大会を登録</h2><label className="field"><span>大会名</span><input required maxLength={60} value={name} onChange={(event) => setName(event.target.value)} placeholder="例：第2回 IIDX 王決定戦" /></label><label className="field"><span>開催日</span><input type="date" value={eventDate} onChange={(event) => setEventDate(event.target.value)} /></label><label className="archive-checkbox"><input type="checkbox" checked={createAsArchive} onChange={(event) => setCreateAsArchive(event.target.checked)} /><span><strong>過去回として登録する</strong><small>参加者・組み合わせ・結果を後から手動入力できます。</small></span></label><div className="modal-actions"><button type="button" onClick={onClose}>キャンセル</button><button className="primary" disabled={busy}>大会を登録</button></div></form></Modal>;
}

function LoginModal({ email, password, busy, setEmail, setPassword, onSubmit, onClose }: { email: string; password: string; busy: boolean; setEmail: (value: string) => void; setPassword: (value: string) => void; onSubmit: (event: FormEvent) => void; onClose: () => void }) {
  return <Modal onClose={onClose}><form onSubmit={onSubmit}><p className="dialog-kicker">運営者専用</p><h2>運営ログイン</h2><label className="field"><span>メールアドレス</span><input required type="email" autoComplete="username" value={email} onChange={(event) => setEmail(event.target.value)} /></label><label className="field"><span>パスワード</span><input required type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} /></label><div className="modal-actions"><button type="button" onClick={onClose}>キャンセル</button><button className="primary" disabled={busy}>ログイン</button></div></form></Modal>;
}

function Modal({ children, onClose }: { children: ReactNode; onClose: () => void }) {
  return <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><div className="modal" role="dialog" aria-modal="true"><button className="close" onClick={onClose} aria-label="画面を閉じる">×</button>{children}</div></div>;
}

function Empty({ message }: { message: string }) { return <div className="empty">{message}</div>; }
