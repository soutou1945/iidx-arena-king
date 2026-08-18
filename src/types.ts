/** 大会で使用する試合区分です。 */
export type Stage = "preliminary" | "king" | "middle" | "reverse";

/** 抽選された予選1試合。配信対象は4人のうち2人です。 */
export type DrawMatch = {
  matchNumber: number;
  roundNumber: number;
  tableNumber: number;
  participantIds: number[];
  streamParticipantIds: number[];
};

export type Tournament = {
  id: number;
  name: string;
  eventDate: string;
  createdAt: string;
  isArchived: boolean;
  drawSchedule: DrawMatch[];
  calledMatchNumber: number | null;
};

export type Participant = {
  id: number;
  name: string;
  title: string;
  imageUrl: string;
  createdAt: string;
};

export type Match = {
  id: number;
  stage: Stage;
  roundNumber: number;
  createdAt: string;
};

export type Result = {
  id: number;
  matchId: number;
  participantId: number;
  points: number;
  placement: number;
  selectedChart: string;
};

export type TournamentData = {
  tournaments: Tournament[];
  tournament: Tournament | null;
  participants: Participant[];
  matches: Match[];
  results: Result[];
};

export type ResultInput = {
  participantId: number;
  points: number;
  placement: number;
  selectedChart: string;
};

/** 画面からデータ操作層へ渡す更新内容です。 */
export type MutationPayload = {
  action: "createTournament" | "addParticipant" | "updateParticipant" | "deleteParticipant" | "addMatch" | "updateMatch" | "deleteMatch" | "resetTournament" | "saveDraw" | "callMatch";
  name?: string; participantId?: number; matchId?: number; tournamentName?: string;
  title?: string; imageFile?: File; removeImage?: boolean;
  eventDate?: string; stage?: Stage; results?: ResultInput[];
  isArchived?: boolean;
  drawSchedule?: DrawMatch[]; calledMatchNumber?: number | null;
};

export const emptyTournamentData: TournamentData = { tournaments: [], tournament: null, participants: [], matches: [], results: [] };
