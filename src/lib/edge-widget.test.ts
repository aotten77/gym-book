import { describe, expect, it } from 'vitest';
import {
  EDGE_WIDGET_MARGIN,
  EDGE_WIDGET_OVERHANG_RATIO,
  initialEdgeWidgetPlacement,
  placeEdgeWidget,
} from '@/lib/edge-widget';

const FRAME = {
  frameWidth: 390,
  frameHeight: 844,
  widgetWidth: 100,
  widgetHeight: 52,
};

const OVERHANG = FRAME.widgetWidth * EDGE_WIDGET_OVERHANG_RATIO;
const LEFT_X = EDGE_WIDGET_MARGIN - OVERHANG;
const RIGHT_X = FRAME.frameWidth - FRAME.widgetWidth - EDGE_WIDGET_MARGIN + OVERHANG;

describe('placeEdgeWidget', () => {
  it('lässt den Reiter beim Ziehen stehen, wo er hingezogen wurde', () => {
    expect(placeEdgeWidget({ x: 120, y: 300 }, FRAME)).toEqual({
      x: 120,
      y: 300,
      side: 'left',
    });
  });

  it('begrenzt ihn auf das Bild - abzüglich des gewollten Überhangs', () => {
    expect(placeEdgeWidget({ x: -999, y: -999 }, FRAME)).toEqual({
      x: LEFT_X,
      y: EDGE_WIDGET_MARGIN,
      side: 'left',
    });

    expect(placeEdgeWidget({ x: 9999, y: 9999 }, FRAME)).toEqual({
      x: RIGHT_X,
      y: FRAME.frameHeight - FRAME.widgetHeight - EDGE_WIDGET_MARGIN,
      side: 'right',
    });
  });

  it('rastet beim Loslassen an der näheren Kante ein und behält die Höhe', () => {
    expect(placeEdgeWidget({ x: 30, y: 420 }, FRAME, { snap: true })).toEqual({
      x: LEFT_X,
      y: 420,
      side: 'left',
    });

    expect(placeEdgeWidget({ x: 260, y: 420 }, FRAME, { snap: true })).toEqual({
      x: RIGHT_X,
      y: 420,
      side: 'right',
    });
  });

  it('entscheidet die Seite an der Mitte des Reiters, nicht an seiner Kante', () => {
    // Linke Kante noch links der Bildmitte, der Reiter selbst aber rechts davon.
    const point = { x: FRAME.frameWidth / 2 - 10, y: 200 };

    expect(placeEdgeWidget(point, FRAME, { snap: true }).side).toBe('right');
  });

  it('bleibt bei einem noch ungemessenen Rahmen ohne NaN', () => {
    const placement = placeEdgeWidget(
      { x: Number.NaN, y: Number.NaN },
      { frameWidth: 0, frameHeight: 0, widgetWidth: 0, widgetHeight: 0 },
    );

    expect(Number.isFinite(placement.x)).toBe(true);
    expect(Number.isFinite(placement.y)).toBe(true);
  });
});

describe('initialEdgeWidgetPlacement', () => {
  it('startet rechts im unteren Drittel - nicht über den Wertfeldern', () => {
    const placement = initialEdgeWidgetPlacement(FRAME);

    expect(placement.side).toBe('right');
    expect(placement.x).toBe(RIGHT_X);
    expect(placement.y).toBeGreaterThan(FRAME.frameHeight * 0.55);
    expect(placement.y).toBeLessThan(FRAME.frameHeight * 0.8);
  });
});
