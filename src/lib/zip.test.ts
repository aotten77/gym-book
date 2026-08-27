import { describe, expect, it } from 'vitest';
import { createZipBytes, crc32 } from '@/lib/zip';

const encoder = new TextEncoder();
const modifiedAt = new Date('2026-08-26T09:00:00');

function readUint32(bytes: Uint8Array, offset: number) {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(offset, true);
}

function readUint16(bytes: Uint8Array, offset: number) {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint16(offset, true);
}

describe('crc32', () => {
  it('trifft die bekannten Prüfsummen', () => {
    expect(crc32(encoder.encode(''))).toBe(0);
    expect(crc32(encoder.encode('123456789'))).toBe(0xcbf43926);
    expect(crc32(encoder.encode('The quick brown fox jumps over the lazy dog'))).toBe(0x414fa339);
  });
});

describe('createZipBytes', () => {
  it('schreibt für jeden Eintrag einen lokalen Header mit Name und Inhalt', () => {
    const bytes = createZipBytes(
      [
        { name: 'sessions.csv', content: 'datum,uebung\n2026-08-25,Front Squat LH\n' },
        { name: 'meta.json', content: '{"programm":"Sommerplan"}\n' },
      ],
      modifiedAt,
    );
    const text = new TextDecoder().decode(bytes);

    expect(readUint32(bytes, 0)).toBe(0x04034b50);
    // Unkomprimiert: der Klartext steht so im Archiv, wie er hineinging.
    expect(text).toContain('2026-08-25,Front Squat LH');
    expect(text).toContain('sessions.csv');
    expect(text).toContain('meta.json');
  });

  it('schließt mit einem End-of-central-directory, das auf das Verzeichnis zeigt', () => {
    const entries = [
      { name: 'a.csv', content: 'eins' },
      { name: 'b.csv', content: 'zwei' },
      { name: 'c.json', content: '{}' },
    ];
    const bytes = createZipBytes(entries, modifiedAt);
    const end = bytes.length - 22;

    expect(readUint32(bytes, end)).toBe(0x06054b50);
    expect(readUint16(bytes, end + 8)).toBe(entries.length);
    expect(readUint16(bytes, end + 10)).toBe(entries.length);

    const centralSize = readUint32(bytes, end + 12);
    const centralOffset = readUint32(bytes, end + 16);

    // Das Verzeichnis liegt genau zwischen den Daten und dem Abschluss.
    expect(centralOffset + centralSize).toBe(end);
    expect(readUint32(bytes, centralOffset)).toBe(0x02014b50);
    // Der erste Eintrag beginnt bei null, dahinter folgen die anderen.
    expect(readUint32(bytes, centralOffset + 42)).toBe(0);
  });

  it('trägt Prüfsumme und Länge des Inhalts in den Header ein', () => {
    const content = 'datum,uebung\n';
    const bytes = createZipBytes([{ name: 'sessions.csv', content }], modifiedAt);

    expect(readUint32(bytes, 14)).toBe(crc32(encoder.encode(content)));
    expect(readUint32(bytes, 18)).toBe(content.length);
    expect(readUint32(bytes, 22)).toBe(content.length);
    // Bit 11 meldet den Dateinamen als UTF-8 an.
    expect(readUint16(bytes, 6) & 0x0800).toBe(0x0800);
  });

  it('zählt Umlaute in Bytes, nicht in Zeichen', () => {
    const content = 'übersprungen\n';
    const bytes = createZipBytes([{ name: 'meta.json', content }], modifiedAt);

    expect(readUint32(bytes, 18)).toBe(encoder.encode(content).length);
    expect(readUint32(bytes, 18)).toBeGreaterThan(content.length);
  });

  it('ergibt für denselben Inhalt denselben Bytestrom', () => {
    const build = () => createZipBytes([{ name: 'a.csv', content: 'eins' }], modifiedAt);

    expect(build()).toEqual(build());
  });
});
