/**
 * Wo der minimierte Pausenreiter liegen darf.
 *
 * Reine Geometrie, ohne DOM: die Komponente misst, diese Datei rechnet. Damit
 * lässt sich das Verhalten prüfen, ohne einen Zeiger zu bewegen - und die
 * Regeln stehen an einer Stelle statt verteilt über drei Ereignis-Handler.
 */

/** Abstand zum Rand, wenn der Reiter nicht übersteht. */
export const EDGE_WIDGET_MARGIN = 12;

/**
 * Wie weit der Reiter über die Kante hinausragt, als Anteil seiner Breite.
 *
 * Das ist der ganze Witz dieser Form: was übersteht, verdeckt nichts. Mehr als
 * gut ein Drittel geht nicht - sonst wandert die Zahl aus dem Bild.
 */
export const EDGE_WIDGET_OVERHANG_RATIO = 0.38;

export interface EdgeWidgetFrame {
  frameWidth: number;
  frameHeight: number;
  widgetWidth: number;
  widgetHeight: number;
}

export interface EdgeWidgetPlacement {
  x: number;
  y: number;
  /** An welcher Kante er hängt - danach richtet sich sein Inhalt aus. */
  side: 'left' | 'right';
}

/**
 * Legt den Reiter ab.
 *
 * Ohne `snap` bleibt er, wo der Finger ihn hinzieht - nur eben innerhalb des
 * Bildes. Mit `snap` (beim Loslassen) rastet er an der näheren Kante ein, wie
 * ein minimiertes Video: die Höhe behält er, denn die hat man gerade bewusst
 * gewählt.
 *
 * Die Seite entscheidet die Mitte des Reiters, nicht seine Kante - sonst
 * kippte ein weit überstehender Reiter auf die falsche Seite.
 */
export function placeEdgeWidget(
  point: { x: number; y: number },
  frame: EdgeWidgetFrame,
  options: { snap?: boolean } = {},
): EdgeWidgetPlacement {
  const overhang = frame.widgetWidth * EDGE_WIDGET_OVERHANG_RATIO;
  const minX = EDGE_WIDGET_MARGIN - overhang;
  const maxX = Math.max(minX, frame.frameWidth - frame.widgetWidth - EDGE_WIDGET_MARGIN + overhang);
  const minY = EDGE_WIDGET_MARGIN;
  const maxY = Math.max(minY, frame.frameHeight - frame.widgetHeight - EDGE_WIDGET_MARGIN);

  const y = clamp(point.y, minY, maxY);
  const clampedX = clamp(point.x, minX, maxX);
  const isLeft = clampedX + frame.widgetWidth / 2 < frame.frameWidth / 2;

  if (!options.snap) {
    return { x: clampedX, y, side: isLeft ? 'left' : 'right' };
  }

  return { x: isLeft ? minX : maxX, y, side: isLeft ? 'left' : 'right' };
}

/**
 * Der Startplatz: rechts, im unteren Drittel.
 *
 * Nicht auf halber Höhe - dort liegen im Sheet die Wertfelder mit ihren
 * Plus- und Minusknöpfen, und die sind genau der Grund, aus dem man den
 * Ruhemodus überhaupt weglegt. Weiter unten stehen die schmalen Satzzeilen;
 * verschieben lässt er sich ohnehin.
 */
export function initialEdgeWidgetPlacement(frame: EdgeWidgetFrame): EdgeWidgetPlacement {
  return placeEdgeWidget({ x: frame.frameWidth, y: frame.frameHeight * 0.66 }, frame, {
    snap: true,
  });
}

function clamp(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) {
    return min;
  }

  return Math.min(max, Math.max(min, value));
}
