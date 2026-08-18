import type { Participant, Stage, TournamentData } from "../types";

/** 順位表で表示する、参加者ごとの予選集計値です。 */
export type Standing = Participant & {
  points: number;
  games: number;
  firsts: number;
  fourths: number;
  suddenDeath: boolean;
};

export const stageLabels: Record<Stage, string> = {
  preliminary: "予選",
  king: "王決定戦",
  middle: "中位決定戦",
  reverse: "逆王決定戦",
};

/**
 * 予選結果を「合計pt → 1位回数 → 4位回数の少なさ」の順で並べます。
 * 3条件が同じ参加者は、全員の予選終了後にサドンデス対象として表示します。
 */
export function buildPreliminaryStandings(data: TournamentData): Standing[] {
  const preliminaryMatchIds = new Set(
    data.matches
      .filter((match) => match.stage === "preliminary")
      .map((match) => match.id),
  );

  const preliminaryResults = data.results.filter((result) => {
    return preliminaryMatchIds.has(result.matchId);
  });

  const standings = data.participants.map((participant) => {
    const ownResults = preliminaryResults.filter((result) => {
      return result.participantId === participant.id;
    });

    return {
      ...participant,
      points: ownResults.reduce((sum, result) => sum + result.points, 0),
      games: ownResults.length,
      firsts: ownResults.filter((result) => result.placement === 1).length,
      fourths: ownResults.filter((result) => result.placement === 4).length,
      suddenDeath: false,
    };
  });

  standings.sort((left, right) => {
    if (left.points !== right.points) return right.points - left.points;
    if (left.firsts !== right.firsts) return right.firsts - left.firsts;
    if (left.fourths !== right.fourths) return left.fourths - right.fourths;
    return left.id - right.id;
  });

  standings.forEach((standing, index) => {
    if (standing.games < 6) return;

    standing.suddenDeath = standings.some((other, otherIndex) => {
      if (index === otherIndex || other.games < 6) return false;
      return other.points === standing.points
        && other.firsts === standing.firsts
        && other.fourths === standing.fourths;
    });
  });

  return standings;
}

/** 順位決定戦は獲得pt順、同ptなら予選上位順に並べます。 */
export function buildFinalGroup(
  stage: Stage,
  data: TournamentData,
  preliminaryStandings: Standing[],
) {
  const finalMatchIds = new Set(
    data.matches.filter((match) => match.stage === stage).map((match) => match.id),
  );
  const finalResults = data.results.filter((result) => finalMatchIds.has(result.matchId));

  let eligible: Standing[] = [];
  if (stage === "king") eligible = preliminaryStandings.slice(0, 4);
  if (stage === "middle") eligible = preliminaryStandings.slice(4, 8);
  if (stage === "reverse") eligible = preliminaryStandings.slice(8, 12);

  return eligible
    .map((player) => ({
      ...player,
      finalPoints: finalResults
        .filter((result) => result.participantId === player.id)
        .reduce((sum, result) => sum + result.points, 0),
    }))
    .sort((left, right) => {
      if (left.finalPoints !== right.finalPoints) {
        return right.finalPoints - left.finalPoints;
      }
      const leftIndex = preliminaryStandings.findIndex((row) => row.id === left.id);
      const rightIndex = preliminaryStandings.findIndex((row) => row.id === right.id);
      return leftIndex - rightIndex;
    });
}
