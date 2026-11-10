import { useEffect, useState } from 'react';
import { toast } from './Toast';

interface Props {
  instances: { name: string; version: string; loader: string }[];
  activeInstance: string;
  onClose: () => void;
}
type Item = { key: string; label: string; hint: string; files: number; bytes: number; byDefault: boolean };

const fmtSize = (b: number) => (b > 1 << 30 ? `${(b / (1 << 30)).toFixed(1)} ГБ` : b > 1 << 20 ? `${(b / (1 << 20)).toFixed(0)} МБ` : `${Math.max(1, Math.round(b / 1024))} КБ`);

export default function ImportModal({ instances, activeInstance, onClose }: Props) {
  const [sources, setSources] = useState<{ label: string; path: string }[]>([]);
  const [src, setSrc] = useState('');
  const [items, setItems] = useState<Item[] | null>(null);
  const [worlds, setWorlds] = useState(0);
  const [candidates, setCandidates] = useState<string[]>([]);
  const [picked, setPicked] = useState<Record<string, boolean>>({});
  const [target, setTarget] = useState(activeInstance);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number; file: string } | null>(null);
  const [result, setResult] = useState<string>('');

  useEffect(() => {
    window.grom.importer.detect().then((list) => { setSources(list); if (list[0]) choose(list[0].path); });
    return window.grom.importer.onProgress(setProgress);
  }, []);

  const choose = async (dir: string, keepCandidates = false) => {
    if (!keepCandidates) setCandidates([]);
    setSrc(dir); setItems(null); setError(''); setResult('');
    const r = await window.grom.importer.scan(dir);
    if (!r.success) { setError(r.error || 'Не удалось прочитать папку'); return; }
    setSrc(r.path || dir); setItems(r.items || []); setWorlds(r.worlds || 0);
    if (r.candidates?.length) setCandidates(r.candidates);
    setPicked(Object.fromEntries((r.items || []).map((i) => [i.key, i.byDefault])));
  };
  const browse = async () => { const d = await window.grom.importer.pick(); if (d) choose(d); };

  const keys = Object.keys(picked).filter((k) => picked[k]);
  const totalBytes = (items || []).filter((i) => picked[i.key]).reduce((n, i) => n + i.bytes, 0);

  const start = async () => {
    setBusy(true); setResult(''); setProgress({ done: 0, total: totalBytes, file: '' });
    const r = await window.grom.importer.run(src, target, keys);
    setBusy(false); setProgress(null);
    if (!r.success) { setError(r.error || 'Ошибка переноса'); return; }
    setResult(`Перенесено файлов: ${r.copied}. Без изменений: ${r.skipped}.${r.failed ? ` Не удалось: ${r.failed}.` : ''}${r.backupDir ? ' Старые файлы сохранены в папку _import_backup.' : ''}`);
    toast('Перенос завершён');
  };

  return (
    <div className="modal-overlay" onClick={busy ? undefined : onClose}>
      <div className="modal-box import-modal" onClick={(e) => e.stopPropagation()}>
        <h2>Перенос из другого лаунчера</h2>
        <p className="hint">Настройки графики и управления, ресурспаки, шейдеры, миры, серверы и скины — из TLauncher, Legacy Launcher, официального лаунчера, Prism, CurseForge или Modrinth App. Исходная папка не меняется.</p>

        <label className="import-label">Откуда</label>
        <div className="feat-row">
          <select value={sources.some((s) => s.path === src) ? src : ''} onChange={(e) => e.target.value && choose(e.target.value)} disabled={busy}>
            {!sources.some((s) => s.path === src) && <option value="">{src || (sources.length ? 'Выбери источник' : 'Ничего не найдено автоматически')}</option>}
            {sources.map((s) => <option key={s.path} value={s.path}>{s.label}</option>)}
          </select>
          <button className="small-button" onClick={browse} disabled={busy}>Выбрать папку…</button>
        </div>
        {candidates.length > 1 && (
          <>
            <label className="import-label">Найдено несколько папок игры — выбери нужную</label>
            <select value={src} onChange={(e) => choose(e.target.value, true)} disabled={busy}>
              {candidates.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </>
        )}
        {src && candidates.length <= 1 && <small className="import-path">{src}</small>}
        {error && <p className="import-error">{error}</p>}

        {items && (items.length === 0 ? <p className="hint">В этой папке нечего переносить.</p> : <>
          <label className="import-label">Что перенести</label>
          <div className="import-items">
            {items.map((i) => (
              <label key={i.key} className="import-item">
                <input type="checkbox" checked={!!picked[i.key]} disabled={busy} onChange={(e) => setPicked((p) => ({ ...p, [i.key]: e.target.checked }))} />
                <span><strong>{i.label}{i.key === 'saves' && worlds ? ` · ${worlds}` : ''}</strong>{i.hint && <small>{i.hint}</small>}</span>
                <em>{fmtSize(i.bytes)}</em>
              </label>
            ))}
          </div>

          <label className="import-label">Куда</label>
          <select value={target} onChange={(e) => setTarget(e.target.value)} disabled={busy}>
            <option value="">Общая папка Grom (игра без выбранной сборки)</option>
            {instances.map((i) => <option key={i.name} value={i.name}>Сборка «{i.name}» · {i.loader} {i.version}</option>)}
          </select>
          {picked.mods && <p className="hint">Моды заработают, только если версия Minecraft и загрузчик сборки совпадают с прежними.</p>}
        </>)}

        {progress && progress.total > 0 && (
          <div className="feat-progress"><div style={{ width: `${Math.round((progress.done / progress.total) * 100)}%` }} /><span>{Math.round((progress.done / progress.total) * 100)}% · {progress.file}</span></div>
        )}
        {result && <p className="import-ok">{result}</p>}

        <div className="modal-buttons">
          <button onClick={onClose} disabled={busy}>{result ? 'Готово' : 'Отмена'}</button>
          {!result && <button onClick={start} disabled={busy || !items?.length || !keys.length}>{busy ? 'Переношу…' : `Перенести${totalBytes ? ` · ${fmtSize(totalBytes)}` : ''}`}</button>}
        </div>
      </div>
    </div>
  );
}
