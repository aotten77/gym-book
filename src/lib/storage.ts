import { formatNumber } from '@/lib/format';

export interface StorageStatus {
  /** Ob der Browser die Speicher-API überhaupt anbietet. */
  supported: boolean;
  /** Ob der Speicher als dauerhaft markiert ist und nicht automatisch geräumt wird. */
  persisted: boolean;
  usageBytes?: number;
  quotaBytes?: number;
}

/**
 * Fordert dauerhaften Speicher an.
 *
 * Ohne diese Markierung darf ein Browser IndexedDB bei Speicherdruck oder nach
 * längerer Nichtnutzung räumen - bei einer App, die ihre gesamte
 * Trainingshistorie nur lokal hält, wäre das der Totalverlust. Safari
 * entscheidet anhand eigener Heuristiken (Homescreen, Nutzungshäufigkeit) und
 * zeigt keinen Dialog; ein `false` ist deshalb kein Fehler, sondern eine
 * Information für die Einstellungen.
 *
 * Schützt ausdrücklich *nicht* davor, dass der Nutzer die Homescreen-App
 * löscht - dabei nimmt iOS den gesamten Speicher-Container mit. Dagegen hilft
 * nur ein Export.
 */
export async function requestPersistentStorage() {
  if (typeof navigator === 'undefined' || !navigator.storage?.persist) {
    return false;
  }

  try {
    if (await navigator.storage.persisted?.()) {
      return true;
    }

    return await navigator.storage.persist();
  } catch {
    // Manche Browser werfen im privaten Modus statt `false` zu liefern.
    return false;
  }
}

export async function readStorageStatus(): Promise<StorageStatus> {
  if (typeof navigator === 'undefined' || !navigator.storage?.estimate) {
    return { supported: false, persisted: false };
  }

  try {
    const [persisted, estimate] = await Promise.all([
      navigator.storage.persisted?.() ?? Promise.resolve(false),
      navigator.storage.estimate(),
    ]);

    return {
      supported: true,
      persisted,
      usageBytes: estimate.usage,
      quotaBytes: estimate.quota,
    };
  } catch {
    return { supported: false, persisted: false };
  }
}

export function formatBytes(bytes?: number) {
  if (typeof bytes !== 'number' || Number.isNaN(bytes)) {
    return 'unbekannt';
  }

  if (bytes < 1024) {
    return `${bytes} B`;
  }

  const units = ['KB', 'MB', 'GB'];
  let value = bytes / 1024;
  let unitIndex = 0;

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  // Erst runden, dann deutsch schreiben: "12,3 MB" statt "12.3 MB".
  const digits = value >= 10 || unitIndex === 0 ? 0 : 1;

  return `${formatNumber(Number(value.toFixed(digits)))} ${units[unitIndex]}`;
}
