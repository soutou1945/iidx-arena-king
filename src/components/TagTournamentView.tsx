import { useMemo, useState, type FormEvent } from "react";
import {
  buildTagStandings,
  createFinalMatch,
  createSemifinals,
  findUnresolvedPreliminaryTies,
  generateTagRoundRobin,
  getKnockoutWinner,
  getTagMatchOutcome,
  isTagMatchComplete,
} from "../lib/tagTournament";
import type {
  TagBattle,
  TagBattleOutcome,
  TagMatch,
  TagTeam,
  TagTournamentData,
} from "../types/tagTournament";

type TagViewTab = "standings" | "draw" | "matches" | "players" | "rules";

type TagTournamentViewProps = {
  tab: TagViewTab;
  data: TagTournamentData;
  canEdit: boolean;
  busy: boolean;
  onSave: (nextData: TagTournamentData) => Promise<boolean>;
};

const stageLabels = { preliminary: "予選", semifinal: "準決勝", final: "決勝" } as const;

function teamName(teams: TagTeam[], teamId: string): string {
  return teams.find((team) => team.id === teamId)?.name ?? "未登録チーム";
}

function outcomeLabel(match: TagMatch, teams: TagTeam[]): string {
  const outcome = getTagMatchOutcome(match);
  if (!outcome) return "結果未入力";
  if (outcome === "draw") {
    if (match.suddenDeathWinnerId) return `引分・SD勝者 ${teamName(teams, match.suddenDeathWinnerId)}`;
    return "引分";
  }
  return `${teamName(teams, outcome)} 勝利`;
}

export default function TagTournamentView({ tab, data, canEdit, busy, onSave }: TagTournamentViewProps) {
  if (tab === "players") return <TagTeamsPanel data={data} canEdit={canEdit} busy={busy} onSave={onSave} />;
  if (tab === "standings") return <TagStandingsPanel data={data} canEdit={canEdit} onSave={onSave} />;
  if (tab === "rules") return <TagRulesPanel />;
  return <TagMatchesPanel data={data} canEdit={canEdit} busy={busy} resultsMode={tab === "matches"} onSave={onSave} />;
}

function TagTeamsPanel({ data, canEdit, busy, onSave }: Omit<TagTournamentViewProps, "tab">) {
  const [editingTeamId, setEditingTeamId] = useState("");
  const [name, setName] = useState("");
  const [player1, setPlayer1] = useState("");
  const [player2, setPlayer2] = useState("");
  const [cardsText, setCardsText] = useState("");
  const [message, setMessage] = useState("");

  function clearForm() {
    setEditingTeamId("");
    setName("");
    setPlayer1("");
    setPlayer2("");
    setCardsText("");
    setMessage("");
  }

  function startEditing(team: TagTeam) {
    setEditingTeamId(team.id);
    setName(team.name);
    setPlayer1(team.players[0]?.name ?? "");
    setPlayer2(team.players[1]?.name ?? "");
    setCardsText(team.cardCandidates.join("\n"));
    setMessage("");
  }

  async function saveTeam(event: FormEvent) {
    event.preventDefault();
    setMessage("");
    const trimmedName = name.trim();
    const playerNames = [player1.trim(), player2.trim()];
    const cards = cardsText.split(/\r?\n/).map((card) => card.trim()).filter(Boolean);

    if (!trimmedName || playerNames.some((playerName) => !playerName)) {
      setMessage("チーム名と選手2名を入力してください。");
      return;
    }
    if (playerNames[0] === playerNames[1]) {
      setMessage("異なる2名の選手を登録してください。");
      return;
    }
    const otherTeams = data.teams.filter((team) => team.id !== editingTeamId);
    if (otherTeams.some((team) => team.name.trim().toLowerCase() === trimmedName.toLowerCase())) {
      setMessage("同じチーム名は登録できません。");
      return;
    }
    const registeredPlayerNames = otherTeams.flatMap((team) => team.players.map((player) => player.name.trim().toLowerCase()));
    if (playerNames.some((playerName) => registeredPlayerNames.includes(playerName.toLowerCase()))) {
      setMessage("同じ選手を複数チームへ登録することはできません。");
      return;
    }
    if (cards.length > 8 || new Set(cards.map((card) => card.toLowerCase())).size !== cards.length) {
      setMessage("☆12選曲カードは重複なしで8曲まで登録できます。");
      return;
    }
    if (!editingTeamId && data.teams.length >= 7) {
      setMessage("タッグ戦は7チームまでです。");
      return;
    }

    let nextTeams: TagTeam[];
    if (editingTeamId) {
      nextTeams = data.teams.map((team) => {
        if (team.id !== editingTeamId) return team;
        return {
          ...team,
          name: trimmedName,
          players: [
            { id: team.players[0]?.id ?? crypto.randomUUID(), name: playerNames[0] },
            { id: team.players[1]?.id ?? crypto.randomUUID(), name: playerNames[1] },
          ],
          cardCandidates: cards,
        };
      });
    } else {
      nextTeams = [...data.teams, {
        id: crypto.randomUUID(),
        name: trimmedName,
        players: playerNames.map((playerName) => ({ id: crypto.randomUUID(), name: playerName })),
        cardCandidates: cards,
      }];
    }

    if (await onSave({ ...data, teams: nextTeams })) clearForm();
  }

  async function deleteTeam(team: TagTeam) {
    if (data.matches.length > 0) {
      setMessage("組み合わせ作成後はチームを削除できません。先に組み合わせを作り直してください。");
      return;
    }
    if (!window.confirm(`${team.name}を削除しますか？`)) return;
    await onSave({ ...data, teams: data.teams.filter((item) => item.id !== team.id) });
  }

  return (
    <section>
      <div className="section-heading">
        <div><p className="eyebrow">7チーム・14名</p><h2>チーム登録</h2></div>
        <strong>{data.teams.length} / 7チーム</strong>
      </div>

      {canEdit && (
        <form className="tag-team-form" onSubmit={saveTeam}>
          <label><span>チーム名</span><input value={name} onChange={(event) => setName(event.target.value)} maxLength={40} /></label>
          <label><span>選手1</span><input value={player1} onChange={(event) => setPlayer1(event.target.value)} maxLength={30} /></label>
          <label><span>選手2</span><input value={player2} onChange={(event) => setPlayer2(event.target.value)} maxLength={30} /></label>
          <label className="tag-card-field"><span>☆12選曲カード（1行1曲・最大8曲）</span><textarea value={cardsText} onChange={(event) => setCardsText(event.target.value)} rows={5} placeholder={"候補曲1\n候補曲2\n…"} /></label>
          {message && <p className="form-message" role="alert">{message}</p>}
          <div className="form-actions">
            {editingTeamId && <button type="button" onClick={clearForm}>編集をやめる</button>}
            <button className="primary" disabled={busy}>{editingTeamId ? "チームを更新" : "チームを追加"}</button>
          </div>
        </form>
      )}

      <div className="tag-team-grid">
        {data.teams.map((team, index) => (
          <article key={team.id}>
            <span className="tag-seed">TEAM {index + 1}</span>
            <h3>{team.name}</h3>
            <p>{team.players.map((player) => player.name).join(" ＆ ")}</p>
            <small>☆12カード {team.cardCandidates.length} / 8枚</small>
            {canEdit && <div className="row-actions"><button onClick={() => startEditing(team)}>編集</button><button className="danger-button" onClick={() => void deleteTeam(team)}>削除</button></div>}
          </article>
        ))}
      </div>
    </section>
  );
}

function TagStandingsPanel({ data, canEdit, onSave }: Pick<TagTournamentViewProps, "data" | "canEdit" | "onSave">) {
  const standings = useMemo(() => buildTagStandings(data), [data]);
  const unresolvedTies = useMemo(() => findUnresolvedPreliminaryTies(data), [data]);

  async function resolveTie(teamAId: string, teamBId: string, winnerTeamId: string) {
    const remaining = data.preliminaryTieBreaks.filter((tieBreak) => {
      return !((tieBreak.teamAId === teamAId && tieBreak.teamBId === teamBId)
        || (tieBreak.teamAId === teamBId && tieBreak.teamBId === teamAId));
    });
    await onSave({ ...data, preliminaryTieBreaks: [...remaining, { teamAId, teamBId, winnerTeamId }] });
  }

  return (
    <section>
      <div className="section-heading"><div><p className="eyebrow">勝利3pt・引分1pt・敗北0pt</p><h2>タッグ戦 予選順位</h2></div><span>上位4チームが準決勝進出</span></div>
      <div className="tag-ranking-table">
        <div className="tag-ranking-row tag-ranking-head"><span>順位</span><span>チーム</span><span>試合</span><span>勝</span><span>分</span><span>敗</span><span>pt</span></div>
        {standings.map((standing, index) => <div className="tag-ranking-row" key={standing.id}><b>{index + 1}</b><strong>{standing.name}<small>{standing.players.map((player) => player.name).join(" ＆ ")}</small></strong><span>{standing.played} / 6</span><span>{standing.wins}</span><span>{standing.draws}</span><span>{standing.losses}</span><b>{standing.points}</b></div>)}
      </div>

      {(unresolvedTies.length > 0 || data.preliminaryTieBreaks.length > 0) && <div className="tag-sudden-death"><h3>予選サドンデス</h3><p>同ptかつ直接対決が引き分けだった組です。登録後も勝者を変更できます。</p>{unresolvedTies.map((pair) => <label key={`${pair.teamAId}-${pair.teamBId}`}><span>{teamName(data.teams, pair.teamAId)} 対 {teamName(data.teams, pair.teamBId)}</span><select disabled={!canEdit} value="" onChange={(event) => void resolveTie(pair.teamAId, pair.teamBId, event.target.value)}><option value="">勝者を選択</option><option value={pair.teamAId}>{teamName(data.teams, pair.teamAId)}</option><option value={pair.teamBId}>{teamName(data.teams, pair.teamBId)}</option></select></label>)}{data.preliminaryTieBreaks.map((tieBreak) => <label key={`resolved-${tieBreak.teamAId}-${tieBreak.teamBId}`}><span>{teamName(data.teams, tieBreak.teamAId)} 対 {teamName(data.teams, tieBreak.teamBId)}</span><select disabled={!canEdit} value={tieBreak.winnerTeamId} onChange={(event) => void resolveTie(tieBreak.teamAId, tieBreak.teamBId, event.target.value)}><option value={tieBreak.teamAId}>{teamName(data.teams, tieBreak.teamAId)}</option><option value={tieBreak.teamBId}>{teamName(data.teams, tieBreak.teamBId)}</option></select></label>)}</div>}
    </section>
  );
}

function TagMatchesPanel({ data, canEdit, busy, resultsMode, onSave }: Omit<TagTournamentViewProps, "tab"> & { resultsMode: boolean }) {
  const [editingMatch, setEditingMatch] = useState<TagMatch | null>(null);
  const [message, setMessage] = useState("");
  const preliminaryMatches = data.matches.filter((match) => match.stage === "preliminary");
  const semifinals = data.matches.filter((match) => match.stage === "semifinal");
  const finalMatch = data.matches.find((match) => match.stage === "final");

  async function createSchedule() {
    if (data.matches.length > 0 && !window.confirm("現在の対戦表と結果を破棄して総当たり表を作り直しますか？")) return;
    setMessage("");
    try {
      const matches = generateTagRoundRobin(data.teams);
      await onSave({ ...data, matches, preliminaryTieBreaks: [], calledMatchId: "" });
    } catch (caught) {
      setMessage(caught instanceof Error ? caught.message : "組み合わせを作成できませんでした。");
    }
  }

  async function addSemifinals() {
    setMessage("");
    try {
      await onSave({ ...data, matches: [...data.matches, ...createSemifinals(data)] });
    } catch (caught) {
      setMessage(caught instanceof Error ? caught.message : "準決勝を作成できませんでした。");
    }
  }

  async function addFinal() {
    setMessage("");
    try {
      await onSave({ ...data, matches: [...data.matches, createFinalMatch(data)] });
    } catch (caught) {
      setMessage(caught instanceof Error ? caught.message : "決勝を作成できませんでした。");
    }
  }

  async function saveMatch(nextMatch: TagMatch): Promise<boolean> {
    const saved = await onSave({ ...data, matches: data.matches.map((match) => match.id === nextMatch.id ? nextMatch : match) });
    if (saved) setEditingMatch(null);
    return saved;
  }

  const visibleMatches = resultsMode ? data.matches : preliminaryMatches;
  return (
    <section>
      <div className="section-heading"><div><p className="eyebrow">{resultsMode ? "新曲戦・☆12戦" : "7チーム総当たり"}</p><h2>{resultsMode ? "試合結果" : "対戦スケジュール"}</h2></div>{canEdit && !resultsMode && <button className="primary" disabled={busy || data.teams.length !== 7} onClick={() => void createSchedule()}>{preliminaryMatches.length > 0 ? "総当たり表を作り直す" : "全21試合を作成"}</button>}</div>
      {message && <p className="form-message" role="alert">{message}</p>}
      {resultsMode && canEdit && <div className="tag-bracket-actions">{preliminaryMatches.length === 21 && semifinals.length === 0 && <button className="primary" onClick={() => void addSemifinals()}>準決勝を作成</button>}{semifinals.length === 2 && !finalMatch && <button className="primary" onClick={() => void addFinal()}>決勝を作成</button>}</div>}
      {visibleMatches.length === 0 && <div className="empty">{data.teams.length === 7 ? "対戦表を作成してください。" : "先に7チームを登録してください。"}</div>}
      <TagMatchGroups matches={visibleMatches} teams={data.teams} canEdit={canEdit} onEdit={setEditingMatch} />
      {editingMatch && <TagMatchEditor match={editingMatch} teams={data.teams} allMatches={data.matches} busy={busy} onSave={saveMatch} onClose={() => setEditingMatch(null)} />}
    </section>
  );
}

function TagMatchGroups({ matches, teams, canEdit, onEdit }: { matches: TagMatch[]; teams: TagTeam[]; canEdit: boolean; onEdit: (match: TagMatch) => void }) {
  const stages = (["preliminary", "semifinal", "final"] as const).filter((stage) => matches.some((match) => match.stage === stage));
  return <div className="tag-match-sections">{stages.map((stage) => <section key={stage}><h3>{stageLabels[stage]}</h3><div className="tag-match-grid">{matches.filter((match) => match.stage === stage).map((match) => <article key={match.id}><div><small>{stageLabels[stage]}・第{match.roundNumber}ラウンド</small><strong>{teamName(teams, match.teamAId)} <i>VS</i> {teamName(teams, match.teamBId)}</strong></div><span className={isTagMatchComplete(match) ? "tag-result complete" : "tag-result"}>{outcomeLabel(match, teams)}</span>{canEdit && <button onClick={() => onEdit(match)}>結果を入力・編集</button>}</article>)}</div></section>)}</div>;
}

function updateBattle(battle: TagBattle, field: keyof TagBattle, value: string): TagBattle {
  return { ...battle, [field]: value } as TagBattle;
}

function TagMatchEditor({ match, teams, allMatches, busy, onSave, onClose }: { match: TagMatch; teams: TagTeam[]; allMatches: TagMatch[]; busy: boolean; onSave: (match: TagMatch) => Promise<boolean>; onClose: () => void }) {
  const [draft, setDraft] = useState<TagMatch>(() => structuredClone(match));
  const [message, setMessage] = useState("");
  const teamA = teams.find((team) => team.id === match.teamAId);
  const teamB = teams.find((team) => team.id === match.teamBId);
  const overallOutcome = getTagMatchOutcome(draft);

  function setBattle(kind: "newSongBattle" | "level12Battle", field: keyof TagBattle, value: string) {
    setDraft((current) => ({ ...current, [kind]: updateBattle(current[kind], field, value) }));
  }

  function hasDuplicateNewSong(teamId: string, song: string): boolean {
    const normalizedSong = song.trim().toLowerCase();
    if (!normalizedSong) return false;
    return allMatches.some((otherMatch) => {
      if (otherMatch.id === match.id) return false;
      let registeredSong = "";
      if (otherMatch.teamAId === teamId) registeredSong = otherMatch.newSongBattle.songA;
      if (otherMatch.teamBId === teamId) registeredSong = otherMatch.newSongBattle.songB;
      return registeredSong.trim().toLowerCase() === normalizedSong;
    });
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setMessage("");
    if (!teamA || !teamB) return;
    if (!draft.newSongBattle.playerAId || !draft.newSongBattle.playerBId || !draft.level12Battle.playerAId || !draft.level12Battle.playerBId) {
      setMessage("新曲戦と☆12戦の出場選手を選択してください。");
      return;
    }
    if (draft.newSongBattle.playerAId === draft.level12Battle.playerAId || draft.newSongBattle.playerBId === draft.level12Battle.playerBId) {
      setMessage("チーム2名で新曲戦と☆12戦を分担してください。");
      return;
    }
    if (!draft.newSongBattle.outcome || !draft.level12Battle.outcome) {
      setMessage("新曲戦と☆12戦の勝敗を入力してください。");
      return;
    }
    if (!draft.newSongBattle.songA.trim() || !draft.newSongBattle.songB.trim()
      || !draft.level12Battle.songA.trim() || !draft.level12Battle.songB.trim()) {
      setMessage("新曲戦と☆12戦の選曲・課題曲を入力してください。");
      return;
    }
    if (hasDuplicateNewSong(teamA.id, draft.newSongBattle.songA) || hasDuplicateNewSong(teamB.id, draft.newSongBattle.songB)) {
      setMessage("新曲戦では大会中にチーム内で同じ譜面を重複選曲できません。");
      return;
    }
    const normalizedCardsA = teamA.cardCandidates.map((card) => card.trim().toLowerCase());
    const normalizedCardsB = teamB.cardCandidates.map((card) => card.trim().toLowerCase());
    const level12SongA = draft.level12Battle.songA.trim().toLowerCase();
    const level12SongB = draft.level12Battle.songB.trim().toLowerCase();
    const usesRegularCardsA = match.stage !== "final" || draft.finalCardSourceA === "regular";
    const usesRegularCardsB = match.stage !== "final" || draft.finalCardSourceB === "regular";
    if ((usesRegularCardsA && !normalizedCardsA.includes(level12SongA))
      || (usesRegularCardsB && !normalizedCardsB.includes(level12SongB))) {
      setMessage("通常カードを使用する☆12戦では、受付時に登録した8曲から課題曲を入力してください。");
      return;
    }
    if (match.stage !== "preliminary" && overallOutcome === "draw" && !draft.suddenDeathWinnerId) {
      setMessage("準決勝・決勝の引き分けではサドンデス勝者を選択してください。");
      return;
    }
    await onSave(draft);
  }

  if (!teamA || !teamB) return null;
  return <div className="modal-backdrop"><div className="modal tag-match-modal" role="dialog" aria-modal="true"><button className="close" onClick={onClose}>×</button><form onSubmit={submit}><p className="dialog-kicker">{stageLabels[match.stage]}</p><h2>{teamA.name} 対 {teamB.name}</h2>{message && <p className="form-message">{message}</p>}<TagBattleFields title="(1) 新曲戦" battle={draft.newSongBattle} teamA={teamA} teamB={teamB} onChange={(field, value) => setBattle("newSongBattle", field, value)} /><TagBattleFields title="(2) ☆12戦" battle={draft.level12Battle} teamA={teamA} teamB={teamB} onChange={(field, value) => setBattle("level12Battle", field, value)} />{match.stage === "final" && <fieldset className="tag-final-box"><legend>決勝 ☆12選曲カード</legend><label><span>{teamA.name}</span><select value={draft.finalCardSourceA} onChange={(event) => setDraft({ ...draft, finalCardSourceA: event.target.value as "regular" | "finalBox" })}><option value="regular">通常の選曲カード</option><option value="finalBox">決勝用BOX</option></select></label><label><span>{teamB.name}</span><select value={draft.finalCardSourceB} onChange={(event) => setDraft({ ...draft, finalCardSourceB: event.target.value as "regular" | "finalBox" })}><option value="regular">通常の選曲カード</option><option value="finalBox">決勝用BOX</option></select></label></fieldset>}{match.stage !== "preliminary" && overallOutcome === "draw" && <label className="field tag-sudden-winner"><span>サドンデス勝者</span><select value={draft.suddenDeathWinnerId} onChange={(event) => setDraft({ ...draft, suddenDeathWinnerId: event.target.value })}><option value="">選択してください</option><option value={teamA.id}>{teamA.name}</option><option value={teamB.id}>{teamB.name}</option></select></label>}<div className="modal-actions"><button type="button" onClick={onClose}>キャンセル</button><button className="primary" disabled={busy}>結果を保存</button></div></form></div></div>;
}

function TagBattleFields({ title, battle, teamA, teamB, onChange }: { title: string; battle: TagBattle; teamA: TagTeam; teamB: TagTeam; onChange: (field: keyof TagBattle, value: string) => void }) {
  return <fieldset className="tag-battle-fields"><legend>{title}</legend><div className="tag-battle-team"><h4>{teamA.name}</h4><label><span>出場選手</span><select value={battle.playerAId} onChange={(event) => onChange("playerAId", event.target.value)}><option value="">選択</option>{teamA.players.map((player) => <option key={player.id} value={player.id}>{player.name}</option>)}</select></label><label><span>選曲・課題曲</span><input value={battle.songA} onChange={(event) => onChange("songA", event.target.value)} /></label></div><div className="tag-battle-team"><h4>{teamB.name}</h4><label><span>出場選手</span><select value={battle.playerBId} onChange={(event) => onChange("playerBId", event.target.value)}><option value="">選択</option>{teamB.players.map((player) => <option key={player.id} value={player.id}>{player.name}</option>)}</select></label><label><span>選曲・課題曲</span><input value={battle.songB} onChange={(event) => onChange("songB", event.target.value)} /></label></div><label className="tag-battle-outcome"><span>この選曲戦の結果</span><select value={battle.outcome} onChange={(event) => onChange("outcome", event.target.value as TagBattleOutcome)}><option value="">選択してください</option><option value="teamA">{teamA.name} 勝利</option><option value="draw">引き分け</option><option value="teamB">{teamB.name} 勝利</option></select></label></fieldset>;
}

function TagRulesPanel() {
  return <section><div className="section-heading"><div><p className="eyebrow">7チーム・14名</p><h2>タッグ戦ルール</h2></div></div><div className="rules-grid tag-rules"><article><b>01</b><h3>予選</h3><p>7チーム総当たりで各チーム6試合。勝利3pt、引分1pt、敗北0ptとし、上位4チームが準決勝へ進出します。</p></article><article><b>02</b><h3>対戦形式</h3><p>各試合で新曲戦と☆12戦を実施し、チーム2名で分担してそれぞれに出場します。</p></article><article><b>03</b><h3>新曲戦</h3><p>ZINRAIフォルダのANOTHER譜面から選曲できます。大会中、チーム内で同じ譜面は重複選曲できません。ZINRAI未稼働時は版権曲戦へ変更します。</p></article><article><b>04</b><h3>☆12戦</h3><p>受付時に重複しない自選候補を8枚のカードへ記入。各試合で2枚を提示し、対戦相手が1枚を課題曲として指定します。チーム内の選曲重複は可能です。</p></article><article><b>05</b><h3>準決勝・決勝</h3><p>予選と同じ形式で実施します。決勝に限り、☆12戦の選曲カードを決勝用BOXから使用できます。</p></article><article><b>06</b><h3>サドンデス</h3><p>予選で同ptかつ直接対決が引分の場合、または準決勝・決勝が引分の場合にサドンデスを実施します。</p></article></div></section>;
}
