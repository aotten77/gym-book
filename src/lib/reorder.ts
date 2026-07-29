/**
 * Verschiebt einen Eintrag innerhalb einer Id-Liste.
 *
 * Ersetzt `arrayMove` aus @dnd-kit: die Reihenfolge wird jetzt über Pfeile
 * geändert, weil Drag & Drop schon bei acht Pixeln Bewegung ansprang und beim
 * Scrollen versehentlich sortierte. Indizes außerhalb der Liste geben sie
 * unverändert zurück, damit ein Klick am Listenrand folgenlos bleibt.
 */
export function moveItem<T>(items: T[], fromIndex: number, toIndex: number): T[] {
  if (
    fromIndex === toIndex ||
    fromIndex < 0 ||
    toIndex < 0 ||
    fromIndex >= items.length ||
    toIndex >= items.length
  ) {
    return items;
  }

  const next = [...items];
  const [moved] = next.splice(fromIndex, 1);
  next.splice(toIndex, 0, moved);

  return next;
}
