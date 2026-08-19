import {
  createEmptyTagBattle,
  type TagMatch,
  type TagTeam,
  type TagTieBreak,
  type TagTournamentData,
} from "../types/tagTournament";

export type TagStanding = TagTeam & {
  played: number;
  wins: number;
  draws: number;
  losses: number;
  points: number;
};

export type TagTiePair = { teamAId: string; teamBId: string };

/** 7チームの1回総当たり（7ラウンド・全21試合）を生成します。 */
export function generateTagRoundRobin(teams: TagTeam[]): TagMatch[] {
  if (teams.length !== 7) throw new Error("タッグ戦の抽選には7チームの登録が必要です。");
  if (teams.some((team) => team.players.length !== 2)) throw new Error("各チームに2名の選手を登録してください。");
  if (teams.some((team) => team.cardCandidates.length !== 8)) throw new Error("各チームの☆12選曲カードを8枚登録してください。");

  const rotation: Array<string | null> = teams.map((team) => team.id);
  rotation.push(null);
  const matches: TagMatch[] = [];

  for (let roundIndex = 0; roundIndex < 7; roundIndex += 1) {
    for (let pairIndex = 0; pairIndex < rotation.length / 2; pairIndex += 1) {
      const firstTeamId = rotation[pairIndex];
      const secondTeamId = rotation[rotation.length - 1 - pairIndex];
      if (!firstTeamId || !secondTeamId) continue;

      // ラウンドごとにA/Bを入れ替え、表示上の偏りを抑えます。
      let teamAId = firstTeamId;
      let teamBId = secondTeamId;
      if ((roundIndex + pairIndex) % 2 === 1) {
        teamAId = secondTeamId;
        teamBId = firstTeamId;
      }

      matches.push({
        id: crypto.randomUUID(),
        stage: "preliminary",
        roundNumber: roundIndex + 1,
        teamAId,
        teamBId,
        newSongBattle: createEmptyTagBattle(),
        level12Battle: createEmptyTagBattle(),
        finalCardSourceA: "regular",
        finalCardSourceB: "regular",
        suddenDeathWinnerId: "",
      });
    }

    const lastTeam = rotation.pop();
    if (lastTeam !== undefined) rotation.splice(1, 0, lastTeam);
  }

  return matches;
}

/** 2つの選曲戦が入力済みなら、チーム単位の勝敗を返します。 */
export function getTagMatchOutcome(match: TagMatch): string {
  if (!match.newSongBattle.outcome || !match.level12Battle.outcome) return "";

  let teamAWins = 0;
  let teamBWins = 0;
  if (match.newSongBattle.outcome === "teamA") teamAWins += 1;
  if (match.newSongBattle.outcome === "teamB") teamBWins += 1;
  if (match.level12Battle.outcome === "teamA") teamAWins += 1;
  if (match.level12Battle.outcome === "teamB") teamBWins += 1;

  if (teamAWins > teamBWins) return match.teamAId;
  if (teamBWins > teamAWins) return match.teamBId;
  return "draw";
}

export function isTagMatchComplete(match: TagMatch): boolean {
  return getTagMatchOutcome(match) !== "";
}

/** 準決勝・決勝では引き分け時のサドンデス勝者を含めて勝者を返します。 */
export function getKnockoutWinner(match: TagMatch): string {
  const outcome = getTagMatchOutcome(match);
  if (outcome === "draw") return match.suddenDeathWinnerId;
  return outcome;
}

function findTieBreak(tieBreaks: TagTieBreak[], leftId: string, rightId: string): TagTieBreak | undefined {
  return tieBreaks.find((tieBreak) => {
    return (tieBreak.teamAId === leftId && tieBreak.teamBId === rightId)
      || (tieBreak.teamAId === rightId && tieBreak.teamBId === leftId);
  });
}

/** 勝利3pt・引分1pt・敗北0ptで予選順位を集計します。 */
export function buildTagStandings(data: TagTournamentData): TagStanding[] {
  const preliminaryMatches = data.matches.filter((match) => match.stage === "preliminary");
  const standings = data.teams.map((team) => {
    let played = 0;
    let wins = 0;
    let draws = 0;
    let losses = 0;

    preliminaryMatches.forEach((match) => {
      if (match.teamAId !== team.id && match.teamBId !== team.id) return;
      const outcome = getTagMatchOutcome(match);
      if (!outcome) return;
      played += 1;
      if (outcome === "draw") draws += 1;
      else if (outcome === team.id) wins += 1;
      else losses += 1;
    });

    return { ...team, played, wins, draws, losses, points: wins * 3 + draws };
  });

  standings.sort((left, right) => {
    if (left.points !== right.points) return right.points - left.points;

    const tieBreak = findTieBreak(data.preliminaryTieBreaks, left.id, right.id);
    if (tieBreak?.winnerTeamId === left.id) return -1;
    if (tieBreak?.winnerTeamId === right.id) return 1;

    const directMatch = preliminaryMatches.find((match) => {
      return (match.teamAId === left.id && match.teamBId === right.id)
        || (match.teamAId === right.id && match.teamBId === left.id);
    });
    if (directMatch) {
      const directOutcome = getTagMatchOutcome(directMatch);
      if (directOutcome === left.id) return -1;
      if (directOutcome === right.id) return 1;
    }

    if (left.wins !== right.wins) return right.wins - left.wins;
    return left.id.localeCompare(right.id);
  });

  return standings;
}

/** 同ptかつ直接対決が引分で、まだ勝者が登録されていない組を返します。 */
export function findUnresolvedPreliminaryTies(data: TagTournamentData): TagTiePair[] {
  const standings = buildTagStandings(data);
  const preliminaryMatches = data.matches.filter((match) => match.stage === "preliminary");
  const pairs: TagTiePair[] = [];

  standings.forEach((left, leftIndex) => {
    standings.slice(leftIndex + 1).forEach((right) => {
      if (left.points !== right.points || left.played < 6 || right.played < 6) return;
      const directMatch = preliminaryMatches.find((match) => {
        return (match.teamAId === left.id && match.teamBId === right.id)
          || (match.teamAId === right.id && match.teamBId === left.id);
      });
      if (!directMatch || getTagMatchOutcome(directMatch) !== "draw") return;
      const tieBreak = findTieBreak(data.preliminaryTieBreaks, left.id, right.id);
      if (!tieBreak?.winnerTeamId) pairs.push({ teamAId: left.id, teamBId: right.id });
    });
  });

  return pairs;
}

/** 予選上位4チームから1位対4位・2位対3位の準決勝を作成します。 */
export function createSemifinals(data: TagTournamentData): TagMatch[] {
  const standings = buildTagStandings(data);
  if (standings.length !== 7 || standings.some((standing) => standing.played !== 6)) {
    throw new Error("全21試合の予選結果を入力してから準決勝を作成してください。");
  }
  if (findUnresolvedPreliminaryTies(data).length > 0) {
    throw new Error("予選のサドンデス勝者をすべて登録してください。");
  }

  return [[standings[0], standings[3]], [standings[1], standings[2]]].map(([teamA, teamB]) => ({
    id: crypto.randomUUID(),
    stage: "semifinal",
    roundNumber: 1,
    teamAId: teamA.id,
    teamBId: teamB.id,
    newSongBattle: createEmptyTagBattle(),
    level12Battle: createEmptyTagBattle(),
    finalCardSourceA: "regular",
    finalCardSourceB: "regular",
    suddenDeathWinnerId: "",
  }));
}

/** 2つの準決勝勝者から決勝を作成します。 */
export function createFinalMatch(data: TagTournamentData): TagMatch {
  const semifinals = data.matches.filter((match) => match.stage === "semifinal");
  if (semifinals.length !== 2) throw new Error("準決勝2試合を作成してください。");
  const winners = semifinals.map(getKnockoutWinner);
  if (winners.some((winnerId) => !winnerId)) throw new Error("準決勝の勝者を確定してください。");

  return {
    id: crypto.randomUUID(),
    stage: "final",
    roundNumber: 1,
    teamAId: winners[0],
    teamBId: winners[1],
    newSongBattle: createEmptyTagBattle(),
    level12Battle: createEmptyTagBattle(),
    finalCardSourceA: "regular",
    finalCardSourceB: "regular",
    suddenDeathWinnerId: "",
  };
}
