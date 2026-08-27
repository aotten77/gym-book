/**
 * Ein ZIP-Archiv aus Textdateien - ohne Kompression und ohne Abhängigkeit.
 *
 * Der Analyse-Export besteht aus drei Dateien, und auf iOS ist jeder Weg nach
 * draußen ein Teilen-Menü: drei Dateien einzeln zu teilen heißt drei Mal
 * Teilen-Sheet, drei Mal Ziel wählen. Ein Archiv ist eine Datei, eine Geste.
 *
 * Gespeichert wird mit Methode 0 ("stored"), also unkomprimiert. Das Format
 * dafür ist klein genug, um es hier hinzuschreiben - eine Bibliothek für
 * Deflate wäre mehr Abhängigkeit als der Zweck trägt, und der Export liegt
 * ohnehin im niedrigen zweistelligen Kilobyte-Bereich. `CompressionStream`
 * gäbe es zwar, ist aber asynchron und auf dem Zielgerät erst ab Safari 16.4
 * verfügbar; unkomprimiert läuft überall.
 */

const LOCAL_HEADER_SIGNATURE = 0x04034b50;
const CENTRAL_HEADER_SIGNATURE = 0x02014b50;
const END_OF_CENTRAL_DIRECTORY_SIGNATURE = 0x06054b50;
const VERSION_NEEDED = 20;
/** Bit 11: Dateiname ist UTF-8. Ohne das Flag rät der Entpacker Codepage 437. */
const UTF8_NAME_FLAG = 0x0800;
const METHOD_STORED = 0;

export interface ZipEntry {
  name: string;
  content: string;
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);

  for (let index = 0; index < 256; index += 1) {
    let value = index;

    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }

    table[index] = value >>> 0;
  }

  return table;
})();

export function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;

  for (const byte of bytes) {
    crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }

  return (crc ^ 0xffffffff) >>> 0;
}

/**
 * Zeitstempel im DOS-Format, wie ZIP es seit 1989 verlangt: Sekunden in
 * Zweierschritten, das Jahr ab 1980. Vor 1980 gibt es keine Darstellung -
 * dann bleibt es beim kleinstmöglichen Wert, statt negativ zu überlaufen.
 */
function toDosDateTime(date: Date): { time: number; dosDate: number } {
  const year = Math.max(1980, date.getFullYear());

  return {
    time:
      (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
    dosDate: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
  };
}

/**
 * Baut das Archiv als Bytestrom.
 *
 * `modifiedAt` steckt im Header jeder Datei - als Parameter und nicht als
 * `new Date()` mitten drin, damit derselbe Inhalt denselben Bytestrom ergibt
 * und ein Test das prüfen kann. Die Bytes stehen neben `createZipArchive` auch
 * deshalb für sich, weil jsdoms `Blob` kein `arrayBuffer()` kennt und die
 * Struktur sonst nur im Browser prüfbar wäre.
 */
export function createZipBytes(entries: ZipEntry[], modifiedAt: Date = new Date()): Uint8Array {
  const encoder = new TextEncoder();
  const { time, dosDate } = toDosDateTime(modifiedAt);
  const localParts: Uint8Array[] = [];
  const centralParts: Uint8Array[] = [];
  let offset = 0;

  for (const entry of entries) {
    const name = encoder.encode(entry.name);
    const content = encoder.encode(entry.content);
    const checksum = crc32(content);

    const localHeader = new Uint8Array(30 + name.length);
    const localView = new DataView(localHeader.buffer);
    localView.setUint32(0, LOCAL_HEADER_SIGNATURE, true);
    localView.setUint16(4, VERSION_NEEDED, true);
    localView.setUint16(6, UTF8_NAME_FLAG, true);
    localView.setUint16(8, METHOD_STORED, true);
    localView.setUint16(10, time, true);
    localView.setUint16(12, dosDate, true);
    localView.setUint32(14, checksum, true);
    localView.setUint32(18, content.length, true);
    localView.setUint32(22, content.length, true);
    localView.setUint16(26, name.length, true);
    localView.setUint16(28, 0, true);
    localHeader.set(name, 30);

    const centralHeader = new Uint8Array(46 + name.length);
    const centralView = new DataView(centralHeader.buffer);
    centralView.setUint32(0, CENTRAL_HEADER_SIGNATURE, true);
    centralView.setUint16(4, VERSION_NEEDED, true);
    centralView.setUint16(6, VERSION_NEEDED, true);
    centralView.setUint16(8, UTF8_NAME_FLAG, true);
    centralView.setUint16(10, METHOD_STORED, true);
    centralView.setUint16(12, time, true);
    centralView.setUint16(14, dosDate, true);
    centralView.setUint32(16, checksum, true);
    centralView.setUint32(20, content.length, true);
    centralView.setUint32(24, content.length, true);
    centralView.setUint16(28, name.length, true);
    centralView.setUint16(30, 0, true);
    centralView.setUint16(32, 0, true);
    centralView.setUint16(34, 0, true);
    centralView.setUint16(36, 0, true);
    centralView.setUint32(38, 0, true);
    centralView.setUint32(42, offset, true);
    centralHeader.set(name, 46);

    localParts.push(localHeader, content);
    centralParts.push(centralHeader);
    offset += localHeader.length + content.length;
  }

  const centralSize = centralParts.reduce((sum, part) => sum + part.length, 0);
  const end = new Uint8Array(22);
  const endView = new DataView(end.buffer);
  endView.setUint32(0, END_OF_CENTRAL_DIRECTORY_SIGNATURE, true);
  endView.setUint16(4, 0, true);
  endView.setUint16(6, 0, true);
  endView.setUint16(8, entries.length, true);
  endView.setUint16(10, entries.length, true);
  endView.setUint32(12, centralSize, true);
  endView.setUint32(16, offset, true);
  endView.setUint16(20, 0, true);

  const parts = [...localParts, ...centralParts, end];
  const archive = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let cursor = 0;

  for (const part of parts) {
    archive.set(part, cursor);
    cursor += part.length;
  }

  return archive;
}

export function createZipArchive(entries: ZipEntry[], modifiedAt: Date = new Date()): Blob {
  return new Blob([createZipBytes(entries, modifiedAt)], { type: 'application/zip' });
}
