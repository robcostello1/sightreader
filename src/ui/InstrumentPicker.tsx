import {
  INSTRUMENTS,
  instrumentById,
  positionById,
  type InstrumentFamily,
} from '../config/instruments';
import { fretRangeLabel } from '../config/regions';

/** Families in the order they are shown, with the heading each one carries. */
const FAMILIES: { id: InstrumentFamily; label: string }[] = [
  { id: 'fretted', label: 'Fretted' },
  { id: 'bowed_string', label: 'Bowed strings' },
  { id: 'woodwind', label: 'Woodwind' },
  { id: 'brass', label: 'Brass' },
  { id: 'keyboard', label: 'Keyboard' },
];

export interface InstrumentPickerProps {
  instrumentId: string;
  positionId: string | null;
  onInstrument: (id: string) => void;
  onPosition: (id: string | null) => void;
}

/**
 * The instrument grid, grouped by family so twenty-five of them can be scanned
 * rather than read.
 *
 * The ones not yet supported are shown and disabled rather than left out. An
 * absent instrument reads as an app that does not cover you; a greyed one with
 * a reason reads as an app that knows what it does not do yet.
 *
 * Only the instruments that have a range control show one, and only once
 * picked — putting a second control on two of the twenty-five tiles would cost
 * every other tile its uniformity.
 */
export function InstrumentPicker({
  instrumentId,
  positionId,
  onInstrument,
  onPosition,
}: InstrumentPickerProps) {
  const selected = instrumentById(instrumentId);
  const position = positionById(selected, positionId);

  return (
    <div className="picker">
      {FAMILIES.map((family) => (
        <section key={family.id}>
          <h3 className="picker-family">{family.label}</h3>
          <ul className="picker-grid">
            {INSTRUMENTS.filter((instrument) => instrument.family === family.id).map(
              (instrument) => {
                const gated = instrument.status === 'comingSoon';
                const chosen = instrument.id === instrumentId;
                return (
                  <li key={instrument.id}>
                    <button
                      type="button"
                      className="picker-choice"
                      aria-pressed={chosen}
                      disabled={gated}
                      title={gated ? instrument.comingSoonReason : undefined}
                      onClick={() => {
                        onInstrument(instrument.id);
                        // Positions belong to an instrument; the old one means
                        // nothing here.
                        onPosition(null);
                      }}
                    >
                      <span className="picker-name">{instrument.name}</span>
                      {gated && <span className="picker-note">coming soon</span>}
                    </button>

                    {chosen && selected.positions && (
                      <label className="picker-range">
                        <span className="field-label">
                          {selected.id === 'guitar' ? 'Fretboard position' : 'Range'}
                        </span>
                        <select
                          value={position?.id ?? ''}
                          onChange={(event) => onPosition(event.target.value)}
                        >
                          {selected.positions.map((option) => (
                            <option
                              key={option.id}
                              value={option.id}
                              disabled={option.status === 'comingSoon'}
                            >
                              {option.label}
                              {option.status === 'comingSoon' ? ' — coming soon' : ''}
                            </option>
                          ))}
                        </select>
                        {position?.region && (
                          <span className="muted small">{fretRangeLabel(position.region)}</span>
                        )}
                      </label>
                    )}
                  </li>
                );
              },
            )}
          </ul>
        </section>
      ))}
    </div>
  );
}
