import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Score } from '../notation';
import { flashQuestion, type FlashQuestion } from './questions';
import { mulberry32 } from '../generator/rng';
import { instrumentById } from '../config/instruments';
import { Heading, Text } from '../ui/Text';

/** How long the pattern is on screen. Long enough to see, short enough not to read. */
const FLASH_MS = 1600;

type Phase = 'showing' | 'asking' | 'answered';

export interface FlashProps {
  /** Fixed seed for tests and screenshots; otherwise each question is fresh. */
  seed?: number;
  flashMs?: number;
}

/**
 * Recognition practice: a pattern appears for a moment, disappears, and a
 * question is asked about it.
 *
 * The point is to read a shape rather than decode it note by note, so the
 * pattern is taken away before it can be decoded and the wrong answers are near
 * misses — the same figure a step out, or reversed. Answering wrongly shows
 * both, side by side, which is the part that teaches.
 */
export function Flash({ seed, flashMs = FLASH_MS }: FlashProps) {
  // Drawn once, at the mount: a fresh stream each render would be a new
  // question every time anything moved.
  const [stream] = useState(() => seed ?? Math.floor(Math.random() * 1e9));
  const [round, setRound] = useState(0);
  const [shown, setShown] = useState(true);
  const [chosen, setChosen] = useState<string | null>(null);
  const [score, setScore] = useState({ right: 0, asked: 0 });
  /** Answered, before the render that says so — two taps in one frame are one answer. */
  const answered = useRef(false);

  const question: FlashQuestion = useMemo(
    () => flashQuestion({ rng: mulberry32(stream + round) }),
    [stream, round],
  );

  useEffect(() => {
    const timer = setTimeout(() => setShown(false), flashMs);
    return () => clearTimeout(timer);
  }, [round, flashMs]);

  const phase: Phase = shown ? 'showing' : chosen === null ? 'asking' : 'answered';

  const answer = useCallback(
    (id: string) => {
      if (shown || answered.current) return;
      answered.current = true;
      setChosen(id);
      setScore((previous) => ({
        right: previous.right + (id === question.answer ? 1 : 0),
        asked: previous.asked + 1,
      }));
    },
    [shown, question.answer],
  );

  const guitar = instrumentById('guitar');
  const right = chosen === question.answer;

  return (
    <section className="flash">
      <div className="flash-stage">
        {phase === 'showing' ? (
          <Score exercise={question.shown} instrument={guitar} width={420} />
        ) : (
          <Text tone="muted">{question.prompt}</Text>
        )}
      </div>

      {phase !== 'showing' && (
        <div className="flash-options">
          {question.options.map((option) => {
            const isAnswer = option.id === question.answer;
            const state =
              phase === 'answered' && (isAnswer || option.id === chosen)
                ? isAnswer
                  ? 'is-right'
                  : 'is-wrong'
                : '';
            return (
              <button
                key={option.id}
                type="button"
                className={`flash-option ${state}`}
                onClick={() => answer(option.id)}
                disabled={phase === 'answered'}
              >
                {option.exercise ? (
                  <Score exercise={option.exercise} instrument={guitar} width={260} />
                ) : (
                  option.label
                )}
              </button>
            );
          })}
        </div>
      )}

      {phase === 'answered' && (
        <div className="flash-verdict">
          <Heading level={2} size="small">{right ? 'Yes' : 'No'}</Heading>
          {!right && (
            <Text size="small" tone="muted">
              {question.kind === 'which-pattern'
                ? 'It was the one marked — look at what changed, not at the whole shape.'
                : 'It was the one marked.'}
            </Text>
          )}
          <button
            type="button"
            className="control primary"
            onClick={() => {
              answered.current = false;
              setRound(round + 1);
              setChosen(null);
              setShown(true);
            }}
          >
            Next
          </button>
        </div>
      )}

      <Text size="small" tone="muted">
        {score.right} of {score.asked}
      </Text>
    </section>
  );
}
