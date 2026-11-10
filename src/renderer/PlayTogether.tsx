import { useEffect, useState } from 'react';
import { supabase } from './supabaseClient';
import { toast } from './Toast';

interface Inst { name: string; version: string; loader: string; modsCount: number }
interface Activity { server: string; mc: string; l: string; code: string; instance: string; ts: number; public?: boolean; invited?: string[] }
interface Friend { nickname: string; avatar_url?: string | null; activity: Activity }
interface Props { config: GromConfig; instances: Inst[]; activeInstance: string; refreshInstances: () => void | Promise<void> }

const copy = async (text: string) => {
  try { await navigator.clipboard.writeText(text); toast('Скопировано'); } catch { toast('Не удалось скопировать'); }
};
const FRESH_MS = 6 * 60 * 60 * 1000;
const fmtAddr = (host?: string, port?: number) => (port && port !== 25565 ? `${host}:${port}` : `${host}`);

export default function PlayTogether({ config, instances, activeInstance, refreshInstances }: Props) {
  // ── код сборки ──
  const [exportName, setExportName] = useState(activeInstance || instances[0]?.name || '');
  const [code, setCode] = useState('');
  const [codeInfo, setCodeInfo] = useState('');
  const [busy, setBusy] = useState(false);
  const [importCode, setImportCode] = useState('');
  const [importInfo, setImportInfo] = useState<string>('');
  const [importName, setImportName] = useState('');
  const [progress, setProgress] = useState<{ message: string; progress: number } | null>(null);

  // ── туннель ──
  const [relayHost, setRelayHost] = useState('');
  const [relayPort, setRelayPort] = useState('7000');
  const [lanPort, setLanPort] = useState('');
  const [tunnel, setTunnel] = useState<{ running: boolean; publicHost?: string; publicPort?: number; error?: string }>({ running: false });
  const [isPublic, setIsPublic] = useState(false);
  const [invited, setInvited] = useState('');

  // ── друзья ──
  const [friends, setFriends] = useState<Friend[]>([]);
  const [joining, setJoining] = useState('');

  useEffect(() => {
    window.grom.tunnel.getRelay().then((r) => { setRelayHost(r.host); setRelayPort(String(r.port)); });
    window.grom.tunnel.state().then(setTunnel);
    const offT = window.grom.tunnel.onChanged((s) => { setTunnel(s); if (!s.running) clearActivity(); if (s.error) toast(s.error); });
    const offP = window.grom.share.onProgress(setProgress);
    return () => { offT(); offP(); };
  }, []);

  useEffect(() => {
    const t = setTimeout(async () => {
      if (!importCode.trim()) { setImportInfo(''); return; }
      const r = await window.grom.share.preview(importCode);
      setImportInfo(r.success ? `${r.name} · ${r.loader} ${r.version} · модов: ${r.mods}${r.unresolved ? ` (+${r.unresolved} не из Modrinth — не войдут)` : ''}` : `⚠ ${r.error}`);
      if (r.success && !importName) setImportName(r.name || '');
    }, 300);
    return () => clearTimeout(t);
  }, [importCode]);

  const loadFriends = async () => {
    const cols = 'nickname, avatar_url, activity';
    const [mine, open] = await Promise.all([
      supabase.from('accounts').select(cols).contains('activity', { invited: [config.nickname] }).limit(20),
      supabase.from('accounts').select(cols).contains('activity', { public: true }).limit(20),
    ]);
    const seen = new Set<string>(); const list: Friend[] = [];
    for (const f of [...((mine.data as Friend[]) || []), ...((open.data as Friend[]) || [])]) {
      if (!f.activity?.server || f.nickname === config.nickname || seen.has(f.nickname) || Date.now() - f.activity.ts > FRESH_MS) continue;
      seen.add(f.nickname); list.push(f);
    }
    setFriends(list);
  };
  useEffect(() => { loadFriends(); const t = setInterval(loadFriends, 20000); return () => clearInterval(t); }, []);

  const clearActivity = async () => { await supabase.from('accounts').update({ activity: null, status: 'online' }).eq('nickname', config.nickname); };

  const makeCode = async () => {
    if (!exportName) { toast('Выбери сборку'); return; }
    setBusy(true);
    const r = await window.grom.share.export(exportName);
    setBusy(false);
    if (!r.success) { toast(r.error || 'Ошибка'); return; }
    setCode(r.code || '');
    setCodeInfo(`${r.mods} модов${r.unresolved ? ` · ${r.unresolved} файлов не найдено на Modrinth и не попали в код` : ''}`);
  };

  const installCode = async () => {
    setBusy(true); setProgress({ message: 'Начинаю…', progress: 1 });
    const r = await window.grom.share.import(importCode, importName || undefined);
    setBusy(false); setProgress(null);
    if (!r.success) { toast(r.error || 'Ошибка импорта'); return; }
    await refreshInstances();
    toast(`Сборка «${r.name}» установлена: ${r.installed} модов${r.failed?.length ? `, не скачано: ${r.failed.length}` : ''}`);
    setImportCode(''); setImportName('');
  };

  const saveRelay = async () => { await window.grom.tunnel.setRelay(relayHost, Number(relayPort) || 7000); toast('Relay сохранён'); };
  const detect = async () => {
    const p = await window.grom.tunnel.detectPort();
    if (p) { setLanPort(String(p)); toast(`Найден порт LAN: ${p}`); } else toast('Порт не найден. В игре: Пауза → Открыть для сети');
  };
  const openTunnel = async () => {
    await saveRelay();
    const r = await window.grom.tunnel.start(Number(lanPort));
    if (!r.success) { toast(r.error || 'Не удалось открыть туннель'); return; }
    setTunnel({ running: true, publicHost: r.publicHost, publicPort: r.publicPort });
    const invitedList = invited.split(/[,\s]+/).map((x) => x.trim()).filter(Boolean).slice(0, 20);
    if (isPublic || invitedList.length) {
      const inst = instances.find((i) => i.name === (activeInstance || exportName));
      if (!inst) { toast('Выбери сборку, чтобы друзья могли её установить'); return; }
      const c = await window.grom.share.export(inst.name);
      if (!c.success || !c.code) { toast(c.error || 'Не удалось создать код сборки'); return; }
      const activity: Activity = { server: fmtAddr(r.publicHost, r.publicPort), mc: inst.version, l: inst.loader, code: c.code, instance: inst.name, ts: Date.now(), public: isPublic, invited: invitedList };
      const { error } = await supabase.from('accounts').update({ activity, status: 'playing' }).eq('nickname', config.nickname);
      if (error) toast('Не опубликовано: примени SQL-миграцию activity (supabase/migrations)');
    }
  };
  const closeTunnel = async () => { await window.grom.tunnel.stop(); setTunnel({ running: false }); clearActivity(); };

  const join = async (f: Friend) => {
    const a = f.activity;
    const pv = await window.grom.share.preview(a.code);
    if (!pv.success) { toast(pv.error || 'Код друга повреждён'); return; }
    if (!window.confirm(`Присоединиться к ${f.nickname}?\n\nБудет установлена сборка: ${pv.loader} ${pv.version}, модов: ${pv.mods} (скачиваются только с Modrinth).`)) return;
    setJoining(f.nickname);
    try {
      const wanted = `Игра с ${f.nickname}`;
      let name = instances.find((i) => i.name === wanted && i.version === a.mc)?.name;
      if (!name) {
        const imp = await window.grom.share.import(a.code, wanted);
        if (!imp.success) { toast(imp.error || 'Ошибка установки'); return; }
        name = imp.name; await refreshInstances();
      }
      const res = await window.grom.launch({ nickname: config.nickname, version: a.mc, loader: a.l, ram: config.ram, width: config.width, height: config.height, fullscreen: config.fullscreen, instance: name, server: a.server });
      toast(res.success ? 'Запускаю игру и подключаюсь…' : res.error || 'Ошибка запуска');
    } finally { setJoining(''); setProgress(null); }
  };

  return (
    <div className="feat-page">
      <h1>Вместе</h1>
      {progress && <div className="feat-progress"><div style={{ width: `${progress.progress}%` }} /><span>{progress.message}</span></div>}

      <section className="glass-card guide">
        <div className="feat-head"><h2>Как играть на одном мире с другом</h2></div>
        <div className="guide-cols">
          <div>
            <h3>Ты — хозяин мира</h3>
            <ol>
              <li>Выбери сборку на главной, нажми «ИГРАТЬ» и зайди в свой мир (одиночная игра).</li>
              <li>В игре: <b>Esc → «Открыть для сети»</b> → «Открыть мир для сети». В чате появится сообщение с портом.</li>
              <li>Вернись сюда → «Мой мир для друзей» → <b>«Найти автоматически»</b> → <b>«Открыть туннель»</b>.</li>
              <li>Впиши ники друзей в поле приглашения — они увидят тебя в «Сейчас играют». Или нажми «Копировать адрес» и отправь его в чат.</li>
              <li>Играете с модами? В блоке «Поделиться сборкой» нажми «Создать код» и отправь код другу.</li>
              <li>Не закрывай игру и лаунчер, пока вы играете.</li>
            </ol>
          </div>
          <div>
            <h3>Твой друг</h3>
            <ol>
              <li><b>Самый простой путь:</b> открыть «Вместе» → в списке «Сейчас играют» нажать <b>«Присоединиться»</b>. Лаунчер сам поставит сборку, запустит игру и зайдёт в мир.</li>
              <li>Вручную: «Установить по коду» → вставить код → «Установить». Выбрать эту сборку на главной, версию Minecraft и загрузчик как в коде, нажать «ИГРАТЬ».</li>
              <li>В игре: <b>Сетевая игра → Добавить сервер</b> → вставить адрес, который ты прислал → Готово → Подключиться.</li>
            </ol>
          </div>
        </div>
        <p className="hint">Если не подключается: версия Minecraft у вас должна совпадать; после перезапуска мира порт меняется — нажми «Остановить» и снова «Открыть туннель». Скины друг друга видны, когда у обоих сборка на Fabric или Forge — лаунчер сам добавит мод скинов. Если пишет «Failed to verify username», возможно, у вас разные типы аккаунтов (лицензия и оффлайн) — попробуйте одинаковые.</p>
      </section>

      <section className="glass-card">
        <div className="feat-head"><h2>Сейчас играют</h2><button className="small-button" onClick={loadFriends}>Обновить</button></div>
        {friends.length === 0 ? <p className="hint">Пока никого нет. Здесь появятся друзья, которые пригласили тебя по нику, и те, кто открыл свой мир для всех.</p> : (
          <div className="friend-list">
            {friends.map((f) => (
              <div className="friend-row" key={f.nickname}>
                <div className="friend-avatar">{f.avatar_url ? <img src={f.avatar_url} alt="" /> : f.nickname[0]?.toUpperCase()}</div>
                <div className="friend-copy"><strong>{f.nickname}</strong><small>{f.activity.l} {f.activity.mc} · {f.activity.instance}</small></div>
                <button className="small-button primary" disabled={!!joining} onClick={() => join(f)}>{joining === f.nickname ? 'Подготовка…' : 'Присоединиться'}</button>
              </div>
            ))}
          </div>
        )}
      </section>

      <div className="feat-grid">
        <section className="glass-card">
          <h2>Поделиться сборкой</h2>
          <p className="hint">Короткий код вместо файлов: друг вставляет его и получает те же версии модов.</p>
          <div className="feat-row">
            <select value={exportName} onChange={(e) => setExportName(e.target.value)}>
              {instances.length === 0 && <option value="">Нет сборок</option>}
              {instances.map((i) => <option key={i.name} value={i.name}>{i.name} · {i.loader} {i.version}</option>)}
            </select>
            <button className="small-button primary" disabled={busy || !exportName} onClick={makeCode}>Создать код</button>
          </div>
          {code && <>
            <textarea readOnly rows={4} value={code} onFocus={(e) => e.target.select()} />
            <div className="feat-row"><span className="hint">{codeInfo}</span><button className="small-button" onClick={() => copy(code)}>Копировать</button></div>
          </>}
        </section>

        <section className="glass-card">
          <h2>Установить по коду</h2>
          <textarea rows={4} placeholder="GROM1.…" value={importCode} onChange={(e) => setImportCode(e.target.value)} />
          {importInfo && <p className="hint">{importInfo}</p>}
          <div className="feat-row">
            <input placeholder="Название сборки" value={importName} onChange={(e) => setImportName(e.target.value)} />
            <button className="small-button primary" disabled={busy || !importCode.trim() || importInfo.startsWith('⚠')} onClick={installCode}>Установить</button>
          </div>
        </section>
      </div>

      <section className="glass-card">
        <div className="feat-head"><h2>Мой мир для друзей</h2>{tunnel.running && <span className="feat-live">● туннель открыт</span>}</div>
        <p className="hint">Запусти мир, в игре нажми Пауза → «Открыть для сети». Лаунчер сам пробросит порт через relay — без Hamachi и настройки роутера.</p>
        {tunnel.running ? (
          <div className="feat-row">
            <code className="feat-addr">{fmtAddr(tunnel.publicHost, tunnel.publicPort)}</code>
            <button className="small-button" onClick={() => copy(fmtAddr(tunnel.publicHost, tunnel.publicPort))}>Копировать адрес</button>
            <button className="small-button" onClick={closeTunnel}>Остановить</button>
          </div>
        ) : (
          <>
            <details className="feat-adv"><summary>Свой relay-сервер (необязательно)</summary>
              <div className="feat-row">
                <input placeholder="Адрес relay" value={relayHost} onChange={(e) => setRelayHost(e.target.value)} />
                <input style={{ maxWidth: 90 }} placeholder="7000" value={relayPort} onChange={(e) => setRelayPort(e.target.value)} />
              </div>
            </details>
            <div className="feat-row">
              <input placeholder="Порт LAN из игры" value={lanPort} onChange={(e) => setLanPort(e.target.value.replace(/\D/g, ''))} />
              <button className="small-button" onClick={detect}>Найти автоматически</button>
              <button className="small-button primary" disabled={!lanPort || !relayHost} onClick={openTunnel}>Открыть туннель</button>
            </div>
            <div className="feat-row"><input placeholder="Пригласить друзей по нику (через запятую) — они увидят тебя в «Сейчас играют»" value={invited} onChange={(e) => setInvited(e.target.value)} /></div>
            <label className="feat-check"><input type="checkbox" checked={isPublic} onChange={(e) => setIsPublic(e.target.checked)} /> Показывать всем пользователям Grom (адрес и код сборки будут видны каждому — включай только если готов к незнакомцам)</label>
          </>
        )}
      </section>
    </div>
  );
}
