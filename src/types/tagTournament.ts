/** タッグ戦で使用する試合区分です。 */
export type TagMatchStage = "preliminary" | "semifinal" | "final";

/** 1つの選曲戦における勝敗です。 */
export type TagBattleOutcome = "" | "teamA" | "draw" | "teamB";

export type TagPlayer = {
  id: string;
  name: string;
};

export type TagTeam = {
  id: string;
  name: string;
  players: TagPlayer[];
  /** 受付時に記入する、重複しない8枚の☆12選曲カードです。 */
  cardCandidates: string[];
};

export type TagBattle = {
  playerAId: string;
  playerBId: string;
  songA: string;
  songB: string;
  outcome: TagBattleOutcome;
};

export type TagMatch = {
  id: string;
  stage: TagMatchStage;
  roundNumber: number;
  teamAId: string;
  teamBId: string;
  newSongBattle: TagBattle;
  level12Battle: TagBattle;
  /** 決勝のみ、通常カードと決勝用BOXのどちらを使用したか記録します。 */
  finalCardSourceA: "regular" | "finalBox";
  finalCardSourceB: "regular" | "finalBox";
  /** 試合が引き分けた場合のサドンデス勝者です。 */
  suddenDeathWinnerId: string;
};

export type TagTieBreak = {
  teamAId: string;
  teamBId: string;
  winnerTeamId: string;
};

export type TagTournamentData = {
  version: 1;
  teams: TagTeam[];
  matches: TagMatch[];
  preliminaryTieBreaks: TagTieBreak[];
  calledMatchId: string;
};

export function createEmptyTagBattle(): TagBattle {
  return { playerAId: "", playerBId: "", songA: "", songB: "", outcome: "" };
}

export function createEmptyTagTournamentData(): TagTournamentData {
  return { version: 1, teams: [], matches: [], preliminaryTieBreaks: [], calledMatchId: "" };
}
