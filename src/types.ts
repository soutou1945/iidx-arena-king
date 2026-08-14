/** 大会で使用できる試合区分です。 */
export type Stage = "preliminary" | "king" | "middle" | "reverse";

/** Supabaseから取得した大会情報を画面向けの命名に整えた型です。 */
export type Tournament = {
  id: number;
  name: string;
  eventDate: string;
  createdAt: string;
};

/** 大会に参加するプレイヤーです。 */
export type Participant = {
  id: number;
  name: string;
  createdAt: string;
};

/** 予選または順位決定戦の1試合を表します。 */
export type Match = {
  id: number;
  stage: Stage;
  roundNumber: number;
  createdAt: string;
};

/** 1人分の試合結果です。 */
export type Result = {
  id: number;
  matchId: number;
  participantId: number;
  points: number;
  placement: number;
  selectedChart: string;
};

/** 画面表示に必要な大会データ一式です。 */
export type TournamentData = {
  tournaments: Tournament[];
  tournament: Tournament | null;
  participants: Participant[];
  matches: Match[];
  results: Result[];
};

/** 試合登録時にSupabaseへ渡す1人分の入力値です。 */
export type ResultInput = {
  participantId: number;
  points: number;
  placement: number;
  selectedChart: string;
};

/** 画面からデータ操作層へ渡す操作内容です。 */
export type MutationPayload = {
  action: "createTournament" | "addParticipant" | "deleteParticipant" | "addMatch" | "deleteMatch" | "resetTournament";
  name?: string;
  participantId?: number;
  matchId?: number;
  tournamentName?: string;
  eventDate?: string;
  stage?: Stage;
  results?: ResultInput[];
};

/** 大会未選択時にも画面を安全に描画するための初期値です。 */
export const emptyTournamentData: TournamentData = {
  tournaments: [],
  tournament: null,
  participants: [],
  matches: [],
  results: [],
};
