import { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Alert } from '@/components/Alert';
import { SectionCard } from '@/components/SectionCard';
import { Button } from '@/components/ui/Button';
import { TextField } from '@/components/ui/Field';
import {
  checkApiKey,
  clearApiKey,
  getTtsView,
  saveApiKey,
  updateTtsSettings,
} from '@/db/tts-actions';
import { formatNumber } from '@/lib/format';
import { parseNumberInput, toInputValue } from '@/lib/number-input';
import { playAnnouncementFromGesture } from '@/lib/announcement-audio';

type Feedback = { kind: 'success' | 'error'; text: string } | null;

/**
 * Einstellungen → Sprachausgabe: Google-Schlüssel, Stimme, Kontingent.
 *
 * Der Schlüssel wird nach dem Speichern nur maskiert angezeigt (letzte vier
 * Zeichen); das Eingabefeld leert sich. Fehlermeldungen kommen fertig und ohne
 * Schlüssel aus dem TTS-Client.
 */
export function SpeechSettingsSection() {
  const view = useLiveQuery(() => getTtsView(), []);
  const [keyDraft, setKeyDraft] = useState('');
  const [voice, setVoice] = useState('');
  const [freeChars, setFreeChars] = useState('');
  const [price, setPrice] = useState('');
  const [keyFeedback, setKeyFeedback] = useState<Feedback>(null);
  const [settingsFeedback, setSettingsFeedback] = useState<Feedback>(null);
  const [isChecking, setIsChecking] = useState(false);
  const [seeded, setSeeded] = useState(false);

  useEffect(() => {
    if (view && !seeded) {
      setVoice(view.voice);
      setFreeChars(toInputValue(view.freeCharsPerMonth));
      setPrice(toInputValue(view.pricePerMillionUsd));
      setSeeded(true);
    }
  }, [view, seeded]);

  async function handleSaveKey() {
    try {
      await saveApiKey(keyDraft);
      setKeyDraft('');
      setKeyFeedback({ kind: 'success', text: 'Schlüssel gespeichert.' });
    } catch (error) {
      setKeyFeedback({
        kind: 'error',
        text: error instanceof Error ? error.message : 'Schlüssel konnte nicht gespeichert werden.',
      });
    }
  }

  async function handleClearKey() {
    await clearApiKey();
    setKeyFeedback({ kind: 'success', text: 'Schlüssel gelöscht.' });
  }

  async function handleCheckKey() {
    setIsChecking(true);
    setKeyFeedback(null);

    try {
      // Erzeugen darf dauern; abgespielt wird aus derselben Geste heraus erst danach,
      // `playAnnouncementFromGesture` weckt den Kontext selbst.
      const { blob, chars } = await checkApiKey();

      try {
        await playAnnouncementFromGesture(blob);
        setKeyFeedback({
          kind: 'success',
          text: `Schlüssel funktioniert. ${formatNumber(chars)} Zeichen wurden gezählt.`,
        });
      } catch (error) {
        setKeyFeedback({
          kind: 'error',
          text: `Schlüssel funktioniert, aber: ${error instanceof Error ? error.message : 'kein Ton.'}`,
        });
      }
    } catch (error) {
      setKeyFeedback({
        kind: 'error',
        text: error instanceof Error ? error.message : 'Schlüssel konnte nicht geprüft werden.',
      });
    } finally {
      setIsChecking(false);
    }
  }

  async function handleSaveSettings() {
    const free = parseNumberInput(freeChars);
    const priceValue = parseNumberInput(price);

    if (free.status !== 'valid' || priceValue.status !== 'valid') {
      setSettingsFeedback({ kind: 'error', text: 'Freikontingent und Preis brauchen eine Zahl ab 0.' });
      return;
    }

    try {
      await updateTtsSettings({
        voice,
        freeCharsPerMonth: free.value,
        pricePerMillionUsd: priceValue.value,
      });
      setSettingsFeedback({ kind: 'success', text: 'Einstellungen gespeichert.' });
    } catch (error) {
      setSettingsFeedback({
        kind: 'error',
        text: error instanceof Error ? error.message : 'Einstellungen konnten nicht gespeichert werden.',
      });
    }
  }

  return (
    <SectionCard
      title="Sprachausgabe"
      subtitle="Ansagen für geführte Einheiten erzeugt Google Cloud Text-to-Speech. Der Schlüssel bleibt auf diesem Gerät und kommt in kein Backup."
    >
      <div className="space-y-4" data-testid="speech-settings">
        <p className="text-sm text-content-secondary">
          {view?.keyHint ? (
            <>
              Gespeicherter Schlüssel: <span className="font-mono">{view.keyHint}</span>
            </>
          ) : (
            'Noch kein Schlüssel gespeichert.'
          )}
        </p>

        <TextField
          label="Google-Schlüssel"
          hint="Eigener Schlüssel, beschränkt auf die Text-to-Speech-API."
          type="password"
          autoComplete="off"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          value={keyDraft}
          onChange={(event) => setKeyDraft(event.target.value)}
        />

        <div className="grid grid-cols-2 gap-3">
          <Button variant="primary" onClick={() => void handleSaveKey()} disabled={!keyDraft.trim()}>
            Speichern
          </Button>
          <Button variant="secondary" onClick={() => void handleClearKey()} disabled={!view?.keyHint}>
            Löschen
          </Button>
        </div>

        <Button
          variant="secondary"
          fullWidth
          onClick={() => void handleCheckKey()}
          disabled={isChecking || !view?.keyHint}
        >
          {isChecking ? 'Wird geprüft...' : 'Schlüssel prüfen'}
        </Button>

        {keyFeedback ? <Alert variant={keyFeedback.kind}>{keyFeedback.text}</Alert> : null}

        <TextField label="Stimme" value={voice} onChange={(event) => setVoice(event.target.value)} />
        <TextField
          label="Freikontingent (Zeichen pro Monat)"
          inputMode="numeric"
          value={freeChars}
          onChange={(event) => setFreeChars(event.target.value)}
        />
        <TextField
          label="Preis in $ je 1 Mio. Zeichen"
          inputMode="decimal"
          value={price}
          onChange={(event) => setPrice(event.target.value)}
        />

        <Button variant="secondary" fullWidth onClick={() => void handleSaveSettings()}>
          Einstellungen speichern
        </Button>

        {settingsFeedback ? <Alert variant={settingsFeedback.kind}>{settingsFeedback.text}</Alert> : null}

        <p className="text-sm text-content-muted" data-testid="speech-month-chars">
          diesen Monat: {formatNumber(view?.monthChars ?? 0)} Zeichen
        </p>
      </div>
    </SectionCard>
  );
}
