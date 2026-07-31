import { describe, expect, it } from 'vitest';

import type { RestTimerTrack, Side, WorkoutSetLog } from '@/domain/models';
import {
  buildRestBadges,
  clampRestSeconds,
  DEFAULT_REST_SECONDS,
  findRestTrack,
  isRestTrackReady,
  pruneRestTracks,
  remainingRestSeconds,
  removeRestTrack,
  removeRestTracksForExercise,
  resolveManualRestTarget,
  REST_TRACK_GRACE_SECONDS,
  selectPrimaryRestTrack,
  upsertRestTrack,
} from '@/domain/rest-timer';

const NOW = 1_800_000_000_000;

function createTrack(
  sessionExerciseId: string,
  side: Side,
  remainingSeconds: number,
): RestTimerTrack {
  return {
    sessionExerciseId,
    side,
    endsAt: NOW + remainingSeconds * 1000,
    durationSeconds: 90,
  };
}

function createLog(
  id: string,
  sessionExerciseId: string,
  side: Side,
  setNumber: number,
  completed: boolean,
): WorkoutSetLog {
  return { id, sessionExerciseId, setKind: 'work', side, setNumber, completed };
}

describe('clampRestSeconds', () => {
  it('fängt Unsinn mit dem Standardwert ab', () => {
    expect(clampRestSeconds(Number.NaN)).toBe(DEFAULT_REST_SECONDS);
  });

  it('begrenzt nach unten und nach oben', () => {
    expect(clampRestSeconds(0)).toBe(5);
    expect(clampRestSeconds(9000)).toBe(3600);
    expect(clampRestSeconds(90.4)).toBe(90);
  });
});

describe('upsertRestTrack', () => {
  it('ersetzt die Spur derselben Übung und Seite, statt sie zu verdoppeln', () => {
    const tracks = upsertRestTrack(
      [createTrack('exercise-1', 'right', 30)],
      createTrack('exercise-1', 'right', 90),
    );

    expect(tracks).toHaveLength(1);
    expect(remainingRestSeconds(tracks[0], NOW)).toBe(90);
  });

  it('lässt links und rechts derselben Übung unabhängig laufen', () => {
    const tracks = upsertRestTrack(
      [createTrack('exercise-1', 'right', 30)],
      createTrack('exercise-1', 'left', 90),
    );

    expect(tracks).toHaveLength(2);
    expect(remainingRestSeconds(findRestTrack(tracks, 'exercise-1', 'right'), NOW)).toBe(30);
    expect(remainingRestSeconds(findRestTrack(tracks, 'exercise-1', 'left'), NOW)).toBe(90);
  });

  it('lässt zwei Übungen eines Supersatzes unabhängig laufen', () => {
    const tracks = upsertRestTrack(
      [createTrack('exercise-1', 'both', 30)],
      createTrack('exercise-2', 'both', 90),
    );

    expect(tracks).toHaveLength(2);
  });
});

describe('removeRestTrack', () => {
  it('entfernt nur die genannte Seite', () => {
    const tracks = removeRestTrack(
      [createTrack('exercise-1', 'left', 30), createTrack('exercise-1', 'right', 30)],
      'exercise-1',
      'left',
    );

    expect(tracks.map((track) => track.side)).toEqual(['right']);
  });

  it('räumt über removeRestTracksForExercise beide Seiten ab', () => {
    const tracks = removeRestTracksForExercise(
      [
        createTrack('exercise-1', 'left', 30),
        createTrack('exercise-1', 'right', 30),
        createTrack('exercise-2', 'both', 30),
      ],
      'exercise-1',
    );

    expect(tracks.map((track) => track.sessionExerciseId)).toEqual(['exercise-2']);
  });
});

describe('remainingRestSeconds', () => {
  it('steht bei einer abgelaufenen Spur auf 0 statt negativ zu werden', () => {
    expect(remainingRestSeconds(createTrack('exercise-1', 'both', -40), NOW)).toBe(0);
    expect(isRestTrackReady(createTrack('exercise-1', 'both', -40), NOW)).toBe(true);
  });
});

describe('pruneRestTracks', () => {
  it('behält frisch abgelaufene Spuren - sie melden "wieder frei"', () => {
    const tracks = pruneRestTracks([createTrack('exercise-1', 'both', -30)], NOW);

    expect(tracks).toHaveLength(1);
  });

  it('verwirft Spuren, deren Karenzzeit vorbei ist', () => {
    const tracks = pruneRestTracks(
      [createTrack('exercise-1', 'both', -REST_TRACK_GRACE_SECONDS - 60)],
      NOW,
    );

    expect(tracks).toHaveLength(0);
  });
});

describe('selectPrimaryRestTrack', () => {
  it('bevorzugt die Seite der nächsten offenen Satzzeile', () => {
    const tracks = [
      createTrack('exercise-1', 'left', 20),
      createTrack('exercise-1', 'right', 80),
    ];

    expect(selectPrimaryRestTrack(tracks, 'exercise-1', 'right', NOW)?.side).toBe('right');
  });

  it('nimmt sonst die nächste ablaufende Spur der fokussierten Übung', () => {
    const tracks = [
      createTrack('exercise-1', 'left', 20),
      createTrack('exercise-1', 'right', 80),
    ];

    expect(selectPrimaryRestTrack(tracks, 'exercise-1', undefined, NOW)?.side).toBe('left');
  });

  it('fällt auf die nächste ablaufende Spur überhaupt zurück', () => {
    const tracks = [createTrack('exercise-2', 'both', 40), createTrack('exercise-3', 'both', 10)];

    expect(selectPrimaryRestTrack(tracks, 'exercise-1', 'both', NOW)?.sessionExerciseId).toBe(
      'exercise-3',
    );
  });

  it('ignoriert abgelaufene Spuren - eine Meldung ist keine laufende Pause', () => {
    const tracks = [createTrack('exercise-1', 'both', -10)];

    expect(selectPrimaryRestTrack(tracks, 'exercise-1', 'both', NOW)).toBeUndefined();
  });
});

describe('buildRestBadges', () => {
  it('hängt die Spur an die nächste offene Zeile derselben Seite', () => {
    const logs = [
      createLog('log-1', 'exercise-1', 'right', 1, true),
      createLog('log-2', 'exercise-1', 'left', 1, true),
      createLog('log-3', 'exercise-1', 'right', 2, false),
      createLog('log-4', 'exercise-1', 'left', 2, false),
    ];

    const badges = buildRestBadges(logs, [createTrack('exercise-1', 'right', 24)], NOW);

    expect(Object.keys(badges)).toEqual(['log-3']);
    expect(badges['log-3']).toEqual({ remainingSeconds: 24, isReady: false });
  });

  it('meldet eine abgelaufene Spur als bereit', () => {
    const logs = [createLog('log-1', 'exercise-1', 'both', 1, false)];
    const badges = buildRestBadges(logs, [createTrack('exercise-1', 'both', -5)], NOW);

    expect(badges['log-1']).toEqual({ remainingSeconds: 0, isReady: true });
  });

  it('lässt eine Spur ohne offene Zeile aus', () => {
    const logs = [createLog('log-1', 'exercise-1', 'both', 1, true)];

    expect(buildRestBadges(logs, [createTrack('exercise-1', 'both', 30)], NOW)).toEqual({});
  });
});

describe('resolveManualRestTarget', () => {
  it('nimmt die Seite der nächsten offenen Satzzeile', () => {
    const logs = [
      createLog('log-1', 'exercise-1', 'left', 1, true),
      createLog('log-2', 'exercise-1', 'right', 1, false),
    ];

    expect(resolveManualRestTarget('exercise-1', logs)).toBe('right');
  });

  it('fällt ohne offene Zeile auf both zurück', () => {
    const logs = [createLog('log-1', 'exercise-1', 'left', 1, true)];

    expect(resolveManualRestTarget('exercise-1', logs)).toBe('both');
  });
});
