import type { DrawMatch, Participant } from "../types";

/** Fisher-Yates法で元配列を壊さずにシャッフルします。 */
function shuffle<T>(values: readonly T[]): T[] {
  const result = [...values];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [result[index], result[swapIndex]] = [result[swapIndex], result[index]];
  }
  return result;
}

/** 同じ2人が何度も当たる抽選ほど大きな罰点を付けます。 */
function repetitionScore(groups: number[][]): number {
  const pairCounts = new Map<string, number>();
  groups.forEach((group) => {
    for (let left = 0; left < group.length; left += 1) {
      for (let right = left + 1; right < group.length; right += 1) {
        const key = [group[left], group[right]].sort((a, b) => a - b).join(":");
        pairCounts.set(key, (pairCounts.get(key) ?? 0) + 1);
      }
    }
  });
  return [...pairCounts.values()].reduce((sum, count) => sum + Math.max(0, count - 1) ** 2, 0);
}

const streamPairs = [[0,1],[0,2],[0,3],[1,2],[1,3],[2,3]] as const;

/** 各人3回ずつになるよう、各試合の配信対象2名をバックトラックで決定します。 */
function assignStreamPlayers(groups: number[][]): number[][] {
  const counts = new Map<number, number>();
  groups.flat().forEach((id) => counts.set(id, 0));
  const assigned: number[][] = [];

  function search(matchIndex: number): boolean {
    if (matchIndex === groups.length) return [...counts.values()].every((count) => count === 3);
    const group = groups[matchIndex];
    const candidates = shuffle(streamPairs).sort((a, b) => {
      const aCount = (counts.get(group[a[0]]) ?? 0) + (counts.get(group[a[1]]) ?? 0);
      const bCount = (counts.get(group[b[0]]) ?? 0) + (counts.get(group[b[1]]) ?? 0);
      return aCount - bCount;
    });
    for (const [left, right] of candidates) {
      const ids = [group[left], group[right]];
      if (ids.some((id) => (counts.get(id) ?? 0) >= 3)) continue;
      ids.forEach((id) => counts.set(id, (counts.get(id) ?? 0) + 1));
      assigned.push(ids);
      if (search(matchIndex + 1)) return true;
      assigned.pop();
      ids.forEach((id) => counts.set(id, (counts.get(id) ?? 0) - 1));
    }
    return false;
  }

  if (!search(0)) throw new Error("配信台の割り当てを作成できませんでした。もう一度抽選してください。");
  return assigned;
}

/**
 * 12名を6ラウンドに分け、毎ラウンド3試合を生成します。
 * 各ラウンドで全員が1回出場するため、全18試合・1人6試合が必ず成立します。
 */
export function generatePreliminaryDraw(participants: Participant[]): DrawMatch[] {
  if (participants.length !== 12) throw new Error("組み合わせ抽選には12名の登録が必要です。");
  let bestGroups: number[][] | null = null;
  let bestScore = Number.POSITIVE_INFINITY;
  const ids = participants.map((participant) => participant.id);

  // 無作為候補を比較し、対戦相手の重複が少ない組み合わせを採用します。
  for (let attempt = 0; attempt < 2500; attempt += 1) {
    const groups: number[][] = [];
    for (let round = 0; round < 6; round += 1) {
      const order = shuffle(ids);
      for (let table = 0; table < 3; table += 1) groups.push(order.slice(table * 4, table * 4 + 4));
    }
    const score = repetitionScore(groups);
    if (score < bestScore) { bestScore = score; bestGroups = groups; }
  }
  if (!bestGroups) throw new Error("組み合わせを作成できませんでした。");
  const streamAssignments = assignStreamPlayers(bestGroups);
  return bestGroups.map((participantIds, index) => ({
    matchNumber: index + 1, roundNumber: Math.floor(index / 3) + 1, tableNumber: (index % 3) + 1,
    participantIds, streamParticipantIds: streamAssignments[index],
  }));
}
