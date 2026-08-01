const SUPPORTED_MEDIA_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
]);

export function isSupportedMediaType(mimeType: string) {
  return SUPPORTED_MEDIA_TYPES.has(mimeType);
}

/**
 * Löst eine Datei vom Dateisystem und macht sie speicherbar.
 *
 * WebKit legt ein `File` aus einem Datei-Feld nur als Verweis an. Landet
 * dieser Verweis in IndexedDB, bricht die Transaktion mit "Error preparing
 * Blob/File data to be stored in object store" ab - der Inhalt muss vorher
 * einmal gelesen werden. Das passiert bewusst vor der Transaktion: ein
 * `await` auf etwas anderes als Dexie würde sie sonst schließen.
 */
export async function toStorableBlob(file: Blob) {
  const buffer = await new Promise<ArrayBuffer>((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = () => {
      if (reader.result instanceof ArrayBuffer) {
        resolve(reader.result);
        return;
      }

      reject(new Error('Bild konnte nicht gelesen werden.'));
    };

    reader.onerror = () => {
      reject(new Error('Bild konnte nicht gelesen werden.'));
    };

    reader.readAsArrayBuffer(file);
  });

  return new Blob([buffer], { type: file.type });
}

export async function blobToDataUrl(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = () => {
      if (typeof reader.result === 'string') {
        resolve(reader.result);
        return;
      }

      reject(new Error('Blob konnte nicht serialisiert werden.'));
    };

    reader.onerror = () => {
      reject(new Error('Blob konnte nicht gelesen werden.'));
    };

    reader.readAsDataURL(blob);
  });
}

export function dataUrlToBlob(dataUrl: string) {
  const [header, base64Payload] = dataUrl.split(',');

  if (!header || !base64Payload) {
    throw new Error('Media-Daten ungültig.');
  }

  const mimeTypeMatch = header.match(/^data:(.+);base64$/);

  if (!mimeTypeMatch) {
    throw new Error('Media-Daten ungültig.');
  }

  const binary = atob(base64Payload);
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));

  return new Blob([bytes], {
    type: mimeTypeMatch[1],
  });
}

