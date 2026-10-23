"use client";
import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import type {
  RouterConnection,
  PublicRouterSettings,
} from "../../lib/studio/connection";
import { studioRequest } from "../../lib/studio/client";

export function RouterSettingsDialog({
  open,
  initial,
  serverSettings,
  onClose,
  onSave,
}: {
  open: boolean;
  initial: RouterConnection;
  serverSettings?: PublicRouterSettings;
  onClose: () => void;
  onSave: (value: RouterConnection) => void;
}) {
  const [draft, setDraft] = useState(initial);
  const [models, setModels] = useState<string[]>([]);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (open) {
      setDraft(initial);
      setMessage("");
      dialog.current?.showModal();
    } else dialog.current?.close();
  }, [open, initial]);
  const patch = (value: Partial<RouterConnection>) => {
    setDraft((d) => ({ ...d, ...value }));
    setMessage("");
  };
  const discover = async () => {
    setLoading(true);
    setMessage("");
    try {
      const response = await studioRequest("models", { connection: draft });
      setModels(response.models || []);
      setMessage(
        `Connected. Found ${response.models?.length || 0} models. Select your tested OpenAI route; listing models does not verify vision, speech or image access.`,
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Connection failed.");
    } finally {
      setLoading(false);
    }
  };
  return (
    <dialog
      ref={dialog}
      aria-labelledby="router-settings-title"
      className="router-dialog panel"
      onCancel={onClose}
      onClick={(e) => {
        if (e.target === dialog.current) onClose();
      }}
    >
      <div className="stack" onClick={(e) => e.stopPropagation()}>
        <div className="panel-heading">
          <h2 id="router-settings-title">OpenAI through 9router</h2>
          <button
            className="icon-button"
            onClick={onClose}
            aria-label="Close settings"
          >
            <X size={18} />
          </button>
        </div>
        <p className="muted">
          Set NINE_ROUTER_API_KEY in the project's .env.local to keep the key on
          the server. You can also enter a browser-local key here when no
          environment key is set.
        </p>
        <label>
          9router base URL
          <input
            value={draft.baseUrl}
            readOnly={serverSettings?.environmentBaseUrl}
            onChange={(e) => patch({ baseUrl: e.target.value })}
            placeholder="http://127.0.0.1:20128/v1"
          />
        </label>
        <label>
          9router API key
          <input
            type="password"
            autoComplete="off"
            value={serverSettings?.serverKeyConfigured ? "" : draft.apiKey}
            disabled={serverSettings?.serverKeyConfigured}
            onChange={(e) => patch({ apiKey: e.target.value })}
            placeholder={
              serverSettings?.serverKeyConfigured
                ? "Configured in .env.local"
                : "Key from 9router dashboard, if required"
            }
          />
        </label>
        {serverSettings?.serverKeyConfigured && (
          <p className="hint">
            9router API key loaded from .env.local. Its value stays on the
            server.
          </p>
        )}
        <button className="button" disabled={loading} onClick={discover}>
          {loading ? "Connecting…" : "Connect & load models"}
        </button>
        {message && (
          <p role="status" className="notice">
            {message}
          </p>
        )}
        <label>
          OpenAI analysis model
          <input
            list="router-models"
            value={draft.model}
            readOnly={serverSettings?.environmentModel}
            onChange={(e) => patch({ model: e.target.value })}
            placeholder="Select or paste your tested model ID"
          />
        </label>
        <datalist id="router-models">
          {models.map((id) => (
            <option key={id} value={id} />
          ))}
        </datalist>
        <span className="hint">
          Use a vision-capable OpenAI route. Copy its full ID, including the
          provider prefix, from 9router. No model is chosen automatically.
        </span>
        <div className="two-cols">
          <label>
            Transcript source
            <select
              value={draft.transcription}
              onChange={(e) =>
                patch({
                  transcription: e.target
                    .value as RouterConnection["transcription"],
                })
              }
            >
              <option value="LOCAL">Local Whisper · no API charge</option>
              <option value="MANUAL">Keep / enter transcript manually</option>
              <option value="ROUTER">9router speech-to-text · optional</option>
            </select>
          </label>
          <label>
            Transcription language
            <select
              value={draft.language}
              onChange={(e) =>
                patch({
                  language: e.target.value as RouterConnection["language"],
                })
              }
            >
              <option value="auto">Auto · Filipino / English / Taglish</option>
              <option value="tl">Filipino / Taglish</option>
              <option value="en">English</option>
            </select>
          </label>
        </div>
        {draft.transcription === "LOCAL" && (
          <p className="hint">
            Requires Python + faster-whisper. Install with{" "}
            <code>
              python -m pip install -r scripts/requirements-whisper.txt
            </code>
            . The first run downloads multilingual model weights. Speaker
            identity and overlapping speech need manual review.
          </p>
        )}
        {draft.transcription === "ROUTER" && (
          <label>
            Transcription model
            <input
              list="router-models"
              value={draft.transcriptionModel}
              onChange={(e) => patch({ transcriptionModel: e.target.value })}
            />
            <span className="hint">
              Must return segments with start/end timestamps (verbose_json). A
              chat subscription route alone does not provide transcription.
            </span>
          </label>
        )}
        <details>
          <summary>Optional image and speech routes</summary>
          <div className="stack">
            <label className="checkbox">
              <input
                type="checkbox"
                checked={draft.imagesEnabled}
                onChange={(e) => patch({ imagesEnabled: e.target.checked })}
              />
              Enable 9router reference image generation
            </label>
            <p className="hint">
              Uses 9router’s Codex image adapter with source and character
              reference images. Configure the exact image model in the Flow
              workspace; account access must be tested separately.
            </p>
            <label className="checkbox">
              <input
                type="checkbox"
                checked={draft.ttsEnabled}
                onChange={(e) => patch({ ttsEnabled: e.target.checked })}
              />
              Enable 9router speech generation
            </label>
            <p className="hint">
              OpenAI TTS needs a configured speech provider in 9router and may
              incur separate API charges. The current router adapter may ignore
              delivery instructions. ORIGINAL audio needs neither speech
              generation nor a speech API key.
            </p>
          </div>
        </details>
        <div className="inline">
          <button className="button" onClick={onClose}>
            Cancel
          </button>
          <button
            className="button primary"
            disabled={loading}
            onClick={() =>
              onSave({
                ...draft,
                apiKey: draft.apiKey.trim(),
                baseUrl: draft.baseUrl.trim().replace(/\/+$/, ""),
                model: draft.model.trim(),
              })
            }
          >
            Save connection
          </button>
        </div>
      </div>
    </dialog>
  );
}
