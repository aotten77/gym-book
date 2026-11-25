#!/usr/bin/env node
/*
 * Wächter für die oberste Regel des Repos: keine persönlichen Daten in
 * Dateien (CLAUDE.md, „Top rule“). Das Repo ist öffentlich.
 *
 * Geprüft werden nur **hinzugefügte** Zeilen eines Diffs - gegen allgemeine
 * Muster (Gesundheit, Körperstelle mit Seite) und gegen eine private
 * Begriffsliste außerhalb des Repos (`~/.config/privat-begriffe.txt`, eine
 * Zeile je Begriff, `#` für Kommentare; anderer Ort über
 * PRIVACY_TERMS_FILE). Die Liste liegt bewusst nicht hier, sonst verriete sie
 * selbst, was sie schützt.
 *
 *   node scripts/privacy-guard.mjs --staged          (pre-commit)
 *   node scripts/privacy-guard.mjs --range A..B      (pre-push)
 *   node scripts/privacy-guard.mjs --worktree        (alles seit HEAD, auch neue Dateien)
 *
 * Ein Treffer beendet mit Code 1 und nennt Datei, Zeile und Muster. Ein
 * Fehlalarm lässt sich nur durch Umformulieren beheben - eine Ausnahmeliste
 * gibt es absichtlich nicht.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const GENERIC_PATTERNS = [
  /physio/i,
  /\bärzt|\barzt/i,
  /orthopäd/i,
  /\bbefund/i,
  /diagnose/i,
  /reizung/i,
  /verletz/i,
  /entzünd/i,
  /zerrung/i,
  /\bmrt\b/i,
  /(knie|schulter|hüfte|rücken|sprunggelenk|ellbogen|handgelenk|achilles\w*|wade|fuß)\s+(rechts|links)\b/i,
];

// Dieser Wächter selbst nennt die Muster und wird deshalb nicht geprüft.
const SELF = new Set(['scripts/privacy-guard.mjs']);

function privateTerms() {
  const file = process.env.PRIVACY_TERMS_FILE ?? join(homedir(), '.config', 'privat-begriffe.txt');

  if (!existsSync(file)) {
    return [];
  }

  return readFileSync(file, 'utf8')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'))
    .map((term) => ({ term, lower: term.toLowerCase() }));
}

function git(args) {
  return execFileSync('git', args, { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
}

function diffFor(mode, range) {
  const base = ['diff', '--no-color', '--no-ext-diff', '-U0', '--diff-filter=AM'];

  if (mode === '--staged') {
    return git([...base, '--cached']);
  }

  if (mode === '--range') {
    return git([...base, range]);
  }

  // --worktree: Änderungen gegen HEAD plus noch nicht verfolgte Dateien.
  const untracked = git(['ls-files', '--others', '--exclude-standard', '-z'])
    .split('\0')
    .filter(Boolean)
    .map((file) => {
      try {
        return git(['diff', '--no-color', '--no-index', '-U0', '/dev/null', file]);
      } catch (error) {
        // `--no-index` endet mit 1, sobald es Unterschiede gibt.
        return error.stdout ?? '';
      }
    });

  return [git([...base, 'HEAD']), ...untracked].join('\n');
}

const [mode = '--staged', range] = process.argv.slice(2);
const terms = privateTerms();
const findings = [];
let file;
let line = 0;

for (const raw of diffFor(mode, range).split('\n')) {
  if (raw.startsWith('+++ ')) {
    file = raw.replace(/^\+\+\+ (b\/)?/, '');
    continue;
  }

  const hunk = /^@@ -\S+ \+(\d+)/.exec(raw);

  if (hunk) {
    line = Number(hunk[1]);
    continue;
  }

  if (!raw.startsWith('+') || !file || SELF.has(file)) {
    continue;
  }

  const text = raw.slice(1);
  const lower = text.toLowerCase();
  const generic = GENERIC_PATTERNS.find((pattern) => pattern.test(text));
  const own = terms.find(({ lower: term }) => lower.includes(term));

  if (generic || own) {
    // Ein privater Begriff wird nicht ausgegeben - die Meldung landet sonst im Terminal-Log.
    findings.push(`${file}:${line}: ${own ? 'privater Begriff' : `Muster ${generic}`}`);
  }

  line += 1;
}

if (findings.length > 0) {
  console.error('Keine persönlichen Daten in Dateien (CLAUDE.md, „Top rule“). Gefunden:');
  console.error(findings.map((item) => `  ${item}`).join('\n'));
  console.error('Umformulieren mit erkennbar erfundenen Beispielen, dann erneut versuchen.');
  process.exit(1);
}
