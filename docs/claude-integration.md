# Briefing: Claude-Integration in die Gym Book PWA

> **Ergebnis (28.08.2026): verworfen.** Der Anthropic-API-Zugang ist **nicht**
> Teil des Claude-Pro-Abos — Pro gilt für claude.ai, die API läuft über einen
> getrennten Console-Account mit eigenem Guthaben. Der hier geplante Worker
> wurde deshalb nie gebaut. Stattdessen bleibt die Auswertung Handarbeit, nur
> mit kürzerem Weg: „Analyse kopieren" in den Einstellungen legt den Export als
> Text in die Zwischenablage, der Kontext liegt in
> [kontext-trainingsanalyse.md](kontext-trainingsanalyse.md), und die Antwort
> geht über das vorhandene Textfeld des Bibliotheks-Imports zurück.
>
> Das Dokument bleibt wegen der Abschnitte 2.1 bis 2.3 stehen: Hosting-Variante,
> Stand des Imports und Stand des Analyse-Exports sind dort belegt und gelten
> weiter. Alles ab Abschnitt 3 beschreibt einen Plan, der nicht ausgeführt wird.

Stand: 28.08.2026. Übergabe aus einer Chat-Session in eine Claude-Code-Session.
Dauerhafte Projektkonventionen gehören in `CLAUDE.md`, nicht hierher.

---

## 1. Ziel

Die Gym Book PWA soll Trainingsdaten selbst auswerten und Plananpassungen als
Import-JSON erzeugen können, statt dass der Nutzer Exporte manuell in einen Chat
lädt und das Ergebnis wieder importiert.

**Nicht Teil dieser Aufgabe:** Multi-User, Sharing, Änderungen am Trainingsplan
selbst, Änderungen am Datenmodell der Sessions.

---

## 2. Vor dem ersten Commit zu klären — GEKLÄRT am 28.08.2026

### 2.1 Hosting-Variante: GitHub Pages hinter Cloudflare-Proxy

**Es ist kein Cloudflare-Pages-Projekt.** `functions/api/chat.ts` würde nie
ausgeführt — es braucht einen **eigenen Worker mit Route**.

Belege:

- `dig gym.andreasotten.de A` → `172.67.145.80`, `104.21.28.95`. Das sind
  generische Cloudflare-Proxy-Adressen, **nicht** die GitHub-Pages-Adressen
  185.199.108–111.153. Der Record ist also proxied (orange) — die Voraussetzung
  für eine Worker-Route ist erfüllt.
- Nameserver der Zone: `celine.ns.cloudflare.com`, `jaime.ns.cloudflare.com`.
- Der Build kommt aus GitHub Actions und geht nach GitHub Pages
  ([.github/workflows/pages.yml](../.github/workflows/pages.yml):
  `actions/upload-pages-artifact` → `actions/deploy-pages`). Origin ist damit
  GitHub Pages, Cloudflare sitzt nur davor.
- Im Repo gibt es weder `wrangler.toml`/`wrangler.jsonc` noch ein
  `functions/`-Verzeichnis.
- Der Apex `andreasotten.de` steht auf `217.160.0.18` (Strato, DNS only) — nur
  `gym` ist proxied. Deckt sich mit dem dokumentierten Setup.

Access-Team-Domain (aus dem 302 der Live-Site):
`snowy-snowflake-0818.cloudflareaccess.com`. Ein anonymer Request bekommt
HTTP **302** auf diese Adresse, dazu den Header
`www-authenticate: Cloudflare-Access resource_metadata=…`.

**Konsequenz für die Umsetzung:** eigenes Worker-Projekt (`wrangler.toml`,
`workers/` o. ä.) mit Route `gym.andreasotten.de/api/*`, spezifischer als jedes
`/*` auf demselben Host. Der Worker wird separat von der App deployt — der
Pages-Workflow baut ihn nicht mit.

### 2.2 Import-Feature: implementiert, aber **kein Rollback**

Vorhanden und einsatzbereit für Ausbaustufe 2:

- [src/domain/library-import.ts](../src/domain/library-import.ts) — pure.
  `LIBRARY_IMPORT_SCHEMA_VERSION = 1`, `parseLibraryImportPayload` (Zod),
  `planLibraryImport` (der Dry-Run), `planHasChanges`, `hashImportPayload`.
- [src/db/library-import-actions.ts](../src/db/library-import-actions.ts) —
  `buildLibraryImportPlan` (Preview), `applyLibraryImport`, `listLibraryImports`.
- UI: [src/components/LibraryImportSection.tsx](../src/components/LibraryImportSection.tsx).
- Beispiel-Payloads liegen in [docs/import/](import/), zuletzt
  `2026-08-28-plan-update.json` (11 KB). Das ist exakt das Format, das Stufe 2
  erzeugen soll.

**Dry-Run: ja.** `planLibraryImport` ist pure und liefert Einträge mit
`NEU` / `AKTUALISIERT` (inkl. *Feld: alt → neu*) / `UNVERÄNDERT`.
`applyLibraryImport` re-plant **innerhalb** der Transaktion, statt die Preview
auszuführen.

**Idempotent: ja.** Nur benannte Felder werden geschrieben, ein fehlender
Schlüssel ist keine Löschung, nichts wird je gelöscht.

**Rollback: nein — die Annahme im ursprünglichen Briefing war falsch.**
Es gibt keine Rücknahme eines erfolgreichen Imports. Was es gibt, ist die
Dexie-Transaktion, also Atomarität *im Fehlerfall* (alles oder nichts), und ein
`LibraryImportLog` pro Lauf (Zeitstempel, Quelle, Zähler, `payloadHash`) — ein
Protokoll, kein Undo. Auch ein Sicherheitsnetz per automatischem Backup fehlt
hier: `LibraryImportSection` ruft **kein** `exportDatabaseSnapshot` vor dem
Schreiben; dieser Automatismus existiert nur vor `restoreDatabaseSnapshot` in
den Einstellungen.

Für Stufe 2 heißt das: der Satz „kein neuer Sicherheitsmechanismus nötig" gilt
nur mit Einschränkung. Bestätigung durch den Nutzer nach Preview ist da,
Umkehrbarkeit nicht. Vor Stufe 2 zu entscheiden — nicht jetzt.

### 2.3 Analyse-Export: implementiert

- Pure: `buildAnalysisExport` in
  [src/domain/analysis-export.ts](../src/domain/analysis-export.ts):630.
- Wrapper: `exportAnalysisSnapshot` in
  [src/lib/export.ts](../src/lib/export.ts):677 — packt das Ergebnis über
  [src/lib/zip.ts](../src/lib/zip.ts) in ein ZIP und liefert es an den Share-Sheet.

**Der für die API entscheidende Befund:** `buildAnalysisExport` gibt drei
**Strings** zurück —

```ts
interface AnalysisExportFiles {
  sessionsCsv: string;
  metaJson: string;
  progressionCsv: string;
}
```

— und das ZIP entsteht erst danach. Der Client kann diese Strings also direkt
als Payload an den Endpoint schicken, ohne Archiv, ohne Base64, ohne einen
zweiten Filterpfad. Die im ursprünglichen Briefing befürchtete Client-Filterung
(`completed = true`, `setKind = "work"`, Join über `sessionExerciseId`) ist damit
**bereits erledigt** und muss nicht neu gebaut werden: das Modul filtert genau so,
aggregiert Warmups zu einer Zahl und protokolliert jede verworfene Session in
`meta.verworfeneSessions`.

Gegenprobe zur Größenordnung: der Vollexport
`docs/import/gym-book-export-2026-08-27.json` ist **5,3 MB**, die Analyse-Sicht
liegt drei Größenordnungen darunter.

Zu beachten: die Datei enthält drei Dateien, nicht zwei wie im Briefing notiert —
`progression.csv` kommt hinzu. Und `exportAnalysisSnapshot` setzt bewusst **kein**
`markBackupCreated`; ein API-Aufruf darf das erst recht nicht tun.

---

## 3. Architekturentscheidungen (bereits getroffen, nicht neu diskutieren)

**Proxy statt Direktaufruf.** Der API-Key darf nicht ins Bundle. Bei Vite gilt:
kein `VITE_`-Präfix, keine Referenz im Frontend-Build.

**Route auf demselben Hostname.** Der Endpoint liegt unter
`gym.andreasotten.de/api/*`, nicht auf der Apex-Domain. Gleiche Origin, damit
kein CORS, keine Preflights, kein Cookie-Scope-Problem. Voraussetzung: DNS-Record
für `gym` ist proxied — **bestätigt, siehe 2.1**. Route-Patterns von spezifisch
nach allgemein anlegen, ein `/*` auf demselben Host schluckt sonst `/api/*`.

**Cloudflare Access ist die Authentifizierung.** Die Zone ist per Access mit
E-Mail-OTP geschützt. Access läuft vor dem Worker, ein anonymer Request erreicht
den Code nie. Ein eigenes App-Token ist damit optional. Ein Access Service Token
gehört NICHT in den Client — das wäre derselbe Fehler wie der API-Key im Bundle.

**Der Server bestimmt den Request.** Der Client schickt nur Nutzdaten. Modell,
`max_tokens` und System-Prompt setzt der Worker. Sonst steht eine offene
LLM-API im Netz, sobald die URL bekannt wird.

---

## 4. Fallstricke, die bereits identifiziert sind

**CPU-Limit.** Free-Plan: 10 ms CPU pro Request, 100.000 Requests/Tag. Warten auf
`fetch()` zählt nicht als CPU-Zeit, ein langer API-Call ist also unkritisch. Aber:
der Worker darf den Payload nicht parsen. Response-Body durchreichen, nicht
deserialisieren. Der 5-MB-Export wird niemals im Worker verarbeitet — Filterung
passiert im Client (und ist dort laut 2.3 bereits implementiert).

**Abgelaufene Access-Session.** Der Fetch liefert dann HTTP 200 mit dem HTML der
Loginseite, nicht einen Fehler. `response.json()` wirft eine irreführende
Exception. Content-Type prüfen, bei `text/html` einen vollen Seiten-Reload
auslösen — der PIN-Flow ist im Fetch nicht durchführbar. Auf der Live-Site ist
zusätzlich ein **302** auf `snowy-snowflake-0818.cloudflareaccess.com` zu sehen;
je nach `redirect`-Modus des Fetch kommt also entweder die Weiterleitung oder das
HTML an — beides muss erkannt werden.

**Service Worker.** `/api/*` muss network-only sein, ohne Cache und ohne
Fallback. Sonst landet die Access-Loginseite im Cache und das Feature ist tot,
bis der Cache geleert wird. Konkret in [vite.config.ts](../vite.config.ts): der
`workbox.globPatterns`-Block präcached nur Build-Assets, aber `navigateFallback`
(Default der Plugin-Voreinstellung) muss `/api/` ausnehmen —
`navigateFallbackDenylist: [/^\/api\//]`.

**Kontextqualität.** Im Roh-Export sind rund 85 % der Set-Logs leere Placeholder.
Ohne Filterung auf `completed = true` und `setKind = "work"` werden die Antworten
schlechter, nicht besser. Join-Pfad: `workoutSessionExercises` →
`workoutSetLogs` über `sessionExerciseId`. **Erledigt in `buildAnalysisExport`,
siehe 2.3 — nicht neu bauen.**

**System-Prompt.** Die eigentliche Fachlogik steckt nicht im Modell, sondern im
Übergabedokument zum Trainingsplan (gekreuztes Beschwerdebild, Krampfursache war
der statische Halt, keine Isometrie im Nordic Curl, kein statisches Dehnen,
Meniskusvorgeschichte). Ohne diesen Kontext liefert das Modell generische
Reha-Ratschläge, die dem Plan teilweise widersprechen. Der Text gehört
serverseitig in den System-Prompt, versioniert im Repo. **Das Dokument liegt
bislang nicht im Repo** — es muss für Schritt 5 beschafft werden.

---

## 5. Ausbaustufen

**Stufe 1 — Analyse-Endpoint.** Client schickt die kompakte Export-Sicht, zurück
kommt Prosa. Ersetzt den heutigen manuellen Chat-Loop. Kleinster sinnvoller
Schnitt, hier anfangen.

**Stufe 2 — Strukturierter Output.** Das Modell antwortet im bestehenden
Import-Schema statt in Prosa. Ergebnis läuft durch den vorhandenen Dry-Run und
wird vom Nutzer bestätigt. Der Import ist idempotent, aber **nicht** rollback-fähig
(siehe 2.2) — ob das ein zusätzliches Sicherheitsnetz braucht, ist vor Stufe 2 zu
entscheiden.

**Stufe 3 — Tool Use.** Funktionen wie `getProgression`, `previewImport`,
`applyImport` exponieren. Erst hier lohnt der Aufwand, und erst hier braucht es
harte Guardrails: Schreibzugriff ausschließlich über den Dry-Run mit expliziter
Bestätigung.

---

## 6. Vorgeschlagene Reihenfolge

1. ~~Punkt 2 dieses Dokuments klären, Ergebnisse hier eintragen.~~
   **Erledigt am 28.08.2026 — siehe 2.1 bis 2.3.**
2. Worker anlegen (**eigenes Worker-Projekt, keine Pages-Function** — siehe 2.1),
   Secret setzen, mit einem statischen Prompt gegen die API testen. Erst wenn ein
   Hello World durchläuft, weiter.
3. Access-Ablauf-Handling und Service-Worker-Ausnahme implementieren. Bewusst
   vor dem Feature, weil beide Fehler sich als scheinbare API-Fehler tarnen.
4. Analyse-Endpoint (Stufe 1) mit `buildAnalysisExport` als Payload-Quelle.
5. System-Prompt aus dem Trainings-Übergabedokument ableiten und versionieren.
   Das Dokument fehlt noch im Repo.
6. Erst danach Stufe 2 bewerten.

### Was Schritt 2 vom Nutzer braucht

Nicht aus dem Repo herstellbar, blockiert den Hello-World-Test:

- Ein Anthropic-API-Key (`wrangler secret put`), niemals im Repo.
- `wrangler login` bzw. ein Cloudflare-API-Token mit Worker-Deploy-Recht.
- Die Route `gym.andreasotten.de/api/*` im Dashboard oder via `wrangler.toml`.

---

## 7. Referenzen

- Claude API: https://docs.claude.com/en/api/overview
- Cloudflare Workers Limits: https://developers.cloudflare.com/workers/platform/limits/
- Workers Routes: https://developers.cloudflare.com/workers/configuration/routing/routes/

Header-Namen, Modellbezeichnungen und das Tool-Use-Format gegen die Doku prüfen,
nicht aus diesem Dokument übernehmen — es ist nicht die Quelle dafür.
