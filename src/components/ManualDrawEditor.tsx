import { useMemo, useState, type FormEvent } from "react";
import type { DrawMatch, Participant } from "../types";

type ManualDrawEditorProps = {
  participants: Participant[];
  schedule: DrawMatch[];
  disabled: boolean;
  onSave: (schedule: DrawMatch[]) => Promise<boolean>;
};

type EditorState = {
  editingMatchNumber: number | null;
  roundNumber: string;
  tableNumber: string;
  participantIds: string[];
  streamParticipantIds: number[];
};

/** 次に追加する試合のラウンド・台番号を自動で提案します。 */
function createEmptyEditor(scheduleLength: number): EditorState {
  const nextMatchNumber = scheduleLength + 1;
  return {
    editingMatchNumber: null,
    roundNumber: String(Math.floor((nextMatchNumber - 1) / 3) + 1),
    tableNumber: String(((nextMatchNumber - 1) % 3) + 1),
    participantIds: ["", "", "", ""],
    streamParticipantIds: [],
  };
}

/**
 * 過去資料から組み合わせを1試合ずつ復元するための編集フォームです。
 * 18試合が揃っていなくても途中保存できるため、判明した分から登録できます。
 */
export default function ManualDrawEditor({
  participants,
  schedule,
  disabled,
  onSave,
}: ManualDrawEditorProps) {
  const [editor, setEditor] = useState<EditorState>(() => createEmptyEditor(schedule.length));
  const [message, setMessage] = useState("");

  const sortedSchedule = useMemo(() => {
    return [...schedule].sort((left, right) => left.matchNumber - right.matchNumber);
  }, [schedule]);

  function updateParticipant(index: number, value: string) {
    setEditor((current) => ({
      ...current,
      participantIds: current.participantIds.map((participantId, participantIndex) => {
        if (participantIndex === index) return value;
        return participantId;
      }),
      // 参加者を入れ替えた場合、対象外になった配信指定を自動で外します。
      streamParticipantIds: current.streamParticipantIds.filter((participantId) => {
        const nextParticipantIds = current.participantIds.map((currentId, participantIndex) => {
          if (participantIndex === index) return value;
          return currentId;
        });
        return nextParticipantIds.includes(String(participantId));
      }),
    }));
  }

  function toggleStreamPlayer(participantId: number) {
    setEditor((current) => {
      if (current.streamParticipantIds.includes(participantId)) {
        return {
          ...current,
          streamParticipantIds: current.streamParticipantIds.filter((id) => id !== participantId),
        };
      }

      if (current.streamParticipantIds.length >= 2) {
        setMessage("配信台は1試合につき2名まで指定できます。");
        return current;
      }

      return {
        ...current,
        streamParticipantIds: [...current.streamParticipantIds, participantId],
      };
    });
  }

  function startEditing(match: DrawMatch) {
    setMessage("");
    setEditor({
      editingMatchNumber: match.matchNumber,
      roundNumber: String(match.roundNumber),
      tableNumber: String(match.tableNumber),
      participantIds: match.participantIds.map(String),
      streamParticipantIds: [...match.streamParticipantIds],
    });
  }

  function cancelEditing() {
    setMessage("");
    setEditor(createEmptyEditor(schedule.length));
  }

  async function saveMatch(event: FormEvent) {
    event.preventDefault();
    setMessage("");

    const participantIds = editor.participantIds.map(Number);
    if (participantIds.some((participantId) => participantId <= 0)) {
      setMessage("4名すべての参加者を選択してください。");
      return;
    }
    if (new Set(participantIds).size !== 4) {
      setMessage("同じ参加者を1試合に複数回登録することはできません。");
      return;
    }
    if (editor.editingMatchNumber === null && schedule.length >= 18) {
      setMessage("予選の組み合わせは18試合までです。");
      return;
    }

    let matchNumber = schedule.length + 1;
    if (editor.editingMatchNumber !== null) matchNumber = editor.editingMatchNumber;

    const nextMatch: DrawMatch = {
      matchNumber,
      roundNumber: Number(editor.roundNumber),
      tableNumber: Number(editor.tableNumber),
      participantIds,
      streamParticipantIds: editor.streamParticipantIds,
    };

    let nextSchedule: DrawMatch[];
    if (editor.editingMatchNumber === null) {
      nextSchedule = [...schedule, nextMatch];
    } else {
      nextSchedule = schedule.map((match) => {
        if (match.matchNumber === editor.editingMatchNumber) return nextMatch;
        return match;
      });
    }

    const saved = await onSave(nextSchedule);
    if (saved) setEditor(createEmptyEditor(nextSchedule.length));
  }

  async function deleteMatch(matchNumber: number) {
    if (!window.confirm(`第${matchNumber}試合の組み合わせを削除しますか？`)) return;

    // 削除後は呼び出し順が途切れないよう、試合番号だけを1から振り直します。
    const nextSchedule = sortedSchedule
      .filter((match) => match.matchNumber !== matchNumber)
      .map((match, index) => ({ ...match, matchNumber: index + 1 }));

    const saved = await onSave(nextSchedule);
    if (saved) setEditor(createEmptyEditor(nextSchedule.length));
  }

  return (
    <section className="manual-editor" aria-labelledby="manual-draw-title">
      <div className="subsection-heading">
        <div>
          <h3 id="manual-draw-title">組み合わせを手動登録</h3>
          <p>過去資料を確認しながら、判明した試合から1件ずつ登録できます。</p>
        </div>
        <span>{schedule.length} / 18試合</span>
      </div>

      {message && <p className="form-message" role="alert">{message}</p>}

      <form className="manual-draw-form" onSubmit={saveMatch}>
        <div className="manual-meta-fields">
          <label>
            <span>ラウンド</span>
            <input
              required
              type="number"
              min="1"
              value={editor.roundNumber}
              onChange={(event) => setEditor({ ...editor, roundNumber: event.target.value })}
              disabled={disabled}
            />
          </label>
          <label>
            <span>台番号</span>
            <input
              required
              type="number"
              min="1"
              value={editor.tableNumber}
              onChange={(event) => setEditor({ ...editor, tableNumber: event.target.value })}
              disabled={disabled}
            />
          </label>
        </div>

        <div className="manual-player-fields">
          {editor.participantIds.map((participantId, index) => (
            <label key={index}>
              <span>参加者 {index + 1}</span>
              <select
                required
                value={participantId}
                onChange={(event) => updateParticipant(index, event.target.value)}
                disabled={disabled}
              >
                <option value="">選択してください</option>
                {participants.map((participant) => (
                  <option key={participant.id} value={participant.id}>{participant.name}</option>
                ))}
              </select>
            </label>
          ))}
        </div>

        <fieldset className="stream-selector" disabled={disabled}>
          <legend>配信台の参加者（任意・最大2名）</legend>
          <div>
            {editor.participantIds.filter(Boolean).map((participantId) => {
              const numericId = Number(participantId);
              const participant = participants.find((item) => item.id === numericId);
              return (
                <label key={numericId}>
                  <input
                    type="checkbox"
                    checked={editor.streamParticipantIds.includes(numericId)}
                    onChange={() => toggleStreamPlayer(numericId)}
                  />
                  <span>{participant?.name ?? "未登録"}</span>
                </label>
              );
            })}
          </div>
        </fieldset>

        <div className="form-actions">
          {editor.editingMatchNumber !== null && (
            <button type="button" onClick={cancelEditing}>編集をやめる</button>
          )}
          <button className="primary" disabled={disabled}>
            {editor.editingMatchNumber === null ? "組み合わせを追加" : `第${editor.editingMatchNumber}試合を更新`}
          </button>
        </div>
      </form>

      {sortedSchedule.length > 0 && (
        <div className="manual-schedule-list">
          {sortedSchedule.map((match) => (
            <article key={match.matchNumber}>
              <div>
                <strong>第{match.matchNumber}試合</strong>
                <span>ラウンド{match.roundNumber}・台{match.tableNumber}</span>
              </div>
              <p>
                {match.participantIds.map((id) => {
                  return participants.find((participant) => participant.id === id)?.name ?? "未登録";
                }).join(" ／ ")}
              </p>
              <div className="row-actions">
                <button type="button" onClick={() => startEditing(match)} disabled={disabled}>編集</button>
                <button type="button" className="danger-button" onClick={() => void deleteMatch(match.matchNumber)} disabled={disabled}>削除</button>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
