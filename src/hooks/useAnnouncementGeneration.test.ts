import { describe, expect, it } from 'vitest';
import { describeGenerationResult } from '@/hooks/useAnnouncementGeneration';

describe('describeGenerationResult', () => {
  it('meldet erzeugte Ansagen als Erfolg', () => {
    expect(describeGenerationResult({ status: 'complete', generated: 3, missing: 0 })).toEqual({
      tone: 'success',
      text: '3 Ansagen erzeugt.',
    });
  });

  it('sagt, wenn sich die Länge der Anleitung nicht messen ließ', () => {
    expect(
      describeGenerationResult({ status: 'complete', generated: 4, missing: 0, unmeasured: 1 }),
    ).toEqual({
      tone: 'error',
      text: '4 Ansagen erzeugt. Die Länge der Anleitung ließ sich auf diesem Gerät nicht messen – „Mit Anleitung“ bleibt gesperrt.',
    });
  });
});
