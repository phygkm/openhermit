import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api';

interface ModelProvider {
  id: string;
  name: string;
  provider: string;
  model: string;
  maxTokens: number;
  baseUrl: string | null;
  api: string | null;
  thinking: string | null;
  secretName: string;
  enabled: boolean;
  secretSet: boolean;
  createdAt: string;
  updatedAt: string;
}

export function ModelsPanel() {
  const [models, setModels] = useState<ModelProvider[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [editModel, setEditModel] = useState<ModelProvider | null>(null);
  const [secretModel, setSecretModel] = useState<ModelProvider | null>(null);

  const load = useCallback(async () => {
    try {
      setModels(await api<ModelProvider[]>('/api/admin/models'));
      setError('');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const handleDelete = async (id: string) => {
    if (!confirm(`Delete model "${id}"? Agents using this model will need to be reconfigured.`)) return;
    try {
      await api(`/api/admin/models/${encodeURIComponent(id)}`, { method: 'DELETE' });
    } catch (err) {
      alert(`Failed to delete: ${(err as Error).message}`);
    }
    await load();
  };

  const handleToggle = async (m: ModelProvider) => {
    try {
      await api(`/api/admin/models/${encodeURIComponent(m.id)}`, {
        method: 'PUT',
        body: { enabled: !m.enabled },
      });
      await load();
    } catch (err) {
      alert(`Failed to update: ${(err as Error).message}`);
    }
  };

  return (
    <div className="panel">
      <div className="panel__header">
        <h2>Model Providers</h2>
        <button className="btn btn--primary btn--sm" onClick={() => setShowCreate(true)}>
          Add Model
        </button>
      </div>

      {loading && models.length === 0 && (
        <p className="agent-list__empty">Loading models…</p>
      )}

      {!loading && error && <p className="agent-list__empty">{error}</p>}

      {!loading && !error && models.length === 0 && (
        <p className="agent-list__empty">No model providers registered. Add one to enable model switching for agents.</p>
      )}

      <div className="skill-list">
        {models.map((m) => (
          <div className="skill-card" key={m.id}>
            <div className="skill-card__info">
              <span className="skill-card__name">{m.name}</span>
              <span className="skill-card__id">{m.id}</span>
              <div className="skill-card__desc">
                Provider: <code>{m.provider}</code> &middot; Model: <code>{m.model}</code>
                {m.baseUrl ? <> &middot; Base URL: <code>{m.baseUrl}</code></> : null}
                {m.api ? <> &middot; API: <code>{m.api}</code></> : null}
                {m.thinking ? <> &middot; Thinking: <code>{m.thinking}</code></> : null}
              </div>
              <div className="skill-card__path">
                Max tokens: {m.maxTokens} &middot; Secret: <code>{m.secretName}</code>
                {' '}&middot;{' '}
                <span className={`badge badge--${m.secretSet ? 'running' : 'stopped'}`}>
                  {m.secretSet ? 'key set' : 'key missing'}
                </span>
                {' '}&middot;{' '}
                <span className={`badge badge--${m.enabled ? 'running' : 'stopped'}`}>
                  {m.enabled ? 'enabled' : 'disabled'}
                </span>
              </div>
            </div>
            <div className="skill-card__actions">
              <button className="btn btn--sm" onClick={() => setSecretModel(m)}>
                Key
              </button>
              <button className="btn btn--sm" onClick={() => setEditModel(m)}>
                Edit
              </button>
              <button className="btn btn--sm" onClick={() => handleToggle(m)}>
                {m.enabled ? 'Disable' : 'Enable'}
              </button>
              <button className="btn btn--sm btn--danger" onClick={() => handleDelete(m.id)}>
                Delete
              </button>
            </div>
          </div>
        ))}
      </div>

      {showCreate && (
        <ModelFormDialog
          onClose={() => setShowCreate(false)}
          onSaved={load}
        />
      )}
      {editModel && (
        <ModelFormDialog
          model={editModel}
          onClose={() => setEditModel(null)}
          onSaved={load}
        />
      )}
      {secretModel && (
        <ModelSecretDialog
          model={secretModel}
          onClose={() => setSecretModel(null)}
          onSaved={load}
        />
      )}
    </div>
  );
}

// ── Create / Edit dialog ──────────────────────────────────────────────────

function ModelFormDialog({
  model,
  onClose,
  onSaved,
}: {
  model?: ModelProvider;
  onClose: () => void;
  onSaved: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [id, setId] = useState(model?.id ?? '');
  const [name, setName] = useState(model?.name ?? '');
  const [provider, setProvider] = useState(model?.provider ?? 'openrouter');
  const [modelId, setModelId] = useState(model?.model ?? '');
  const [maxTokens, setMaxTokens] = useState(String(model?.maxTokens ?? 8192));
  const [baseUrl, setBaseUrl] = useState(model?.baseUrl ?? '');
  const [apiVal, setApiVal] = useState(model?.api ?? '');
  const [thinking, setThinking] = useState(model?.thinking ?? '');
  const [secretName, setSecretName] = useState(model?.secretName ?? '');
  const [enabled, setEnabled] = useState(model?.enabled ?? true);

  useEffect(() => { dialogRef.current?.showModal(); }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!id.trim() || !provider.trim() || !modelId.trim() || !secretName.trim()) return;

    const body = {
      id: id.trim(),
      name: name.trim() || modelId.trim(),
      provider: provider.trim(),
      model: modelId.trim(),
      maxTokens: Number(maxTokens) || 8192,
      ...(baseUrl.trim() ? { baseUrl: baseUrl.trim() } : {}),
      ...(apiVal.trim() ? { api: apiVal.trim() } : {}),
      ...(thinking.trim() ? { thinking: thinking.trim() } : {}),
      secretName: secretName.trim(),
      enabled,
    };

    try {
      if (model) {
        const { id: _id, ...patch } = body as any;
        void _id;
        await api(`/api/admin/models/${encodeURIComponent(model.id)}`, {
          method: 'PUT',
          body: patch,
        });
      } else {
        await api('/api/admin/models', { method: 'POST', body });
      }
      onClose();
      onSaved();
    } catch (err) {
      alert(`Failed to save: ${(err as Error).message}`);
    }
  };

  return (
    <dialog ref={dialogRef} className="dialog" onClose={onClose}>
      <form className="dialog__form" onSubmit={handleSubmit}>
        <h3>{model ? 'Edit Model' : 'Add Model'}</h3>
        <label className="field">
          <span className="field__label">Model ID</span>
          <input
            className="field__input"
            required
            placeholder="e.g. gemini-flash"
            value={id}
            readOnly={!!model}
            onChange={(e) => setId(e.target.value)}
          />
        </label>
        <label className="field">
          <span className="field__label">Display Name</span>
          <input
            className="field__input"
            placeholder="e.g. Gemini 3 Flash"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <label className="field">
          <span className="field__label">Provider</span>
          <input
            className="field__input"
            required
            placeholder="e.g. openrouter, anthropic, openai"
            value={provider}
            onChange={(e) => setProvider(e.target.value)}
          />
        </label>
        <label className="field">
          <span className="field__label">Model</span>
          <input
            className="field__input"
            required
            placeholder="e.g. google/gemini-3-flash-preview"
            value={modelId}
            onChange={(e) => setModelId(e.target.value)}
          />
        </label>
        <label className="field">
          <span className="field__label">Max Tokens</span>
          <input
            className="field__input"
            type="number"
            value={maxTokens}
            onChange={(e) => setMaxTokens(e.target.value)}
          />
        </label>
        <label className="field">
          <span className="field__label">Base URL (optional)</span>
          <input
            className="field__input"
            placeholder="https://..."
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
          />
        </label>
        <label className="field">
          <span className="field__label">API Type (optional)</span>
          <input
            className="field__input"
            placeholder="e.g. openai, anthropic"
            value={apiVal}
            onChange={(e) => setApiVal(e.target.value)}
          />
        </label>
        <label className="field">
          <span className="field__label">Thinking (optional)</span>
          <select className="field__input" value={thinking} onChange={(e) => setThinking(e.target.value)}>
            <option value="">—</option>
            <option value="off">off</option>
            <option value="minimal">minimal</option>
            <option value="low">low</option>
            <option value="medium">medium</option>
            <option value="high">high</option>
          </select>
        </label>
        <label className="field">
          <span className="field__label">Secret Name</span>
          <input
            className="field__input"
            required
            placeholder="e.g. ANTHROPIC_API_KEY"
            value={secretName}
            onChange={(e) => setSecretName(e.target.value)}
          />
        </label>
        {!model && (
          <label className="field field--inline">
            <input
              type="checkbox"
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
            />
            <span>Enabled</span>
          </label>
        )}
        <div className="dialog__actions">
          <button className="btn btn--ghost" type="button" onClick={onClose}>Cancel</button>
          <button className="btn btn--primary" type="submit">{model ? 'Save' : 'Add'}</button>
        </div>
      </form>
    </dialog>
  );
}

// ── Secret key dialog ─────────────────────────────────────────────────────

function ModelSecretDialog({
  model,
  onClose,
  onSaved,
}: {
  model: ModelProvider;
  onClose: () => void;
  onSaved: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [value, setValue] = useState('');
  const [error, setError] = useState('');

  useEffect(() => { dialogRef.current?.showModal(); }, []);

  const handleSet = async () => {
    if (!value.trim()) return;
    try {
      await api(`/api/admin/gateway/secrets/${encodeURIComponent(model.secretName)}`, {
        method: 'PUT',
        body: { value: value.trim() },
      });
      onClose();
      onSaved();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const handleDelete = async () => {
    if (!confirm(`Remove gateway secret "${model.secretName}"?`)) return;
    try {
      await api(`/api/admin/gateway/secrets/${encodeURIComponent(model.secretName)}`, {
        method: 'DELETE',
      });
      onClose();
      onSaved();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  return (
    <dialog ref={dialogRef} className="dialog" onClose={onClose}>
      <div className="dialog__form">
        <h3>API Key — {model.name}</h3>
        <p className="skill-assign__hint">
          Secret name: <code>{model.secretName}</code>
          <br />
          Status: <span className={`badge badge--${model.secretSet ? 'running' : 'stopped'}`}>
            {model.secretSet ? 'set' : 'missing'}
          </span>
        </p>

        <label className="field">
          <span className="field__label">API Key Value</span>
          <input
            className="field__input"
            type="password"
            placeholder="sk-..."
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void handleSet(); } }}
          />
        </label>

        {error && <p className="config-error">{error}</p>}

        <div className="dialog__actions">
          <button className="btn btn--ghost" type="button" onClick={onClose}>Close</button>
          {model.secretSet && (
            <button className="btn btn--danger" type="button" onClick={handleDelete}>
              Remove
            </button>
          )}
          <button className="btn btn--primary" type="button" onClick={handleSet}>
            {model.secretSet ? 'Update' : 'Set'}
          </button>
        </div>
      </div>
    </dialog>
  );
}
