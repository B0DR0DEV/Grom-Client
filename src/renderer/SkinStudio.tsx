import { useCallback, useEffect, useRef, useState } from 'react';
import { publishSkin } from './skinsCloud';
import SkinViewer from './SkinViewer';

type PresetKey = 'grom' | 'enderman' | 'creeper' | 'ice' | 'knight';
type Variant = 'classic' | 'slim';

const PRESETS: { id: PresetKey; name: string; description: string; main: string; accent: string }[] = [
  { id: 'grom', name: 'Grom Neon', description: 'Фиолетовый техно-скин', main: '#3b1763', accent: '#c084fc' },
  { id: 'enderman', name: 'Enderman', description: 'Тёмный с фиолетовыми глазами', main: '#191521', accent: '#bd63ff' },
  { id: 'creeper', name: 'Creeper', description: 'Классический зелёный', main: '#39813a', accent: '#192b1b' },
  { id: 'ice', name: 'Ice', description: 'Холодные сине-белые оттенки', main: '#225a80', accent: '#a7e7ff' },
  { id: 'knight', name: 'Knight', description: 'Тёмная броня и серебро', main: '#343b48', accent: '#adb9ce' },
];

function makePreset(id: PresetKey): string {
  const c = document.createElement('canvas');
  c.width = 64; c.height = 64;
  const ctx = c.getContext('2d')!;
  ctx.clearRect(0, 0, 64, 64);
  const preset = PRESETS.find((p) => p.id === id)!;
  const skinTone = id === 'enderman' ? '#241c31' : id === 'creeper' ? '#4d9b45' : id === 'ice' ? '#b5dcf0' : id === 'knight' ? '#687383' : '#d4a987';
  const hair = id === 'grom' ? '#100d19' : id === 'enderman' ? '#09070d' : id === 'creeper' ? '#245528' : id === 'ice' ? '#d3f4ff' : '#171c26';
  const outfit = id === 'grom' ? '#241037' : id === 'enderman' ? '#141119' : id === 'creeper' ? '#34713a' : id === 'ice' ? '#286d9a' : '#343b48';
  const trim = preset.accent;
  const fill = (x: number, y: number, w: number, h: number, color: string) => { ctx.fillStyle = color; ctx.fillRect(x, y, w, h); };
  const faces = (regions: number[][], color: string) => regions.forEach(([x, y, w, h]) => fill(x, y, w, h, color));

  // Base head UVs: top, bottom, right, front, left, back.
  faces([[8,0,8,8],[16,0,8,8],[0,8,8,8],[8,8,8,8],[16,8,8,8],[24,8,8,8]], skinTone);
  fill(8, 8, 8, 2, hair); fill(8, 9, 2, 5, hair); fill(14, 9, 2, 5, hair);
  // Face pixels.
  if (id === 'enderman') { fill(10, 12, 2, 1, '#d17aff'); fill(13, 12, 2, 1, '#d17aff'); }
  else if (id === 'creeper') { fill(9, 11, 2, 3, '#142217'); fill(13, 11, 2, 3, '#142217'); fill(11, 13, 2, 3, '#142217'); }
  else { fill(10, 12, 1, 1, id === 'ice' ? '#2d82b4' : '#3a92b9'); fill(13, 12, 1, 1, id === 'ice' ? '#2d82b4' : '#3a92b9'); fill(11, 14, 2, 1, '#5b3130'); }
  // Head outer layer and a little hair/hood only at the top edge.
  faces([[40,0,8,8],[48,0,8,8],[32,8,8,8],[40,8,8,8],[48,8,8,8],[56,8,8,8]], 'rgba(0,0,0,0)');
  fill(40, 0, 8, 8, hair); fill(40, 8, 8, 2, hair);
  if (id === 'knight') { fill(40, 8, 8, 2, trim); fill(42, 9, 4, 1, hair); }

  // Torso base UV faces.
  faces([[20,16,8,4],[28,16,8,4],[16,20,4,12],[20,20,8,12],[28,20,4,12],[32,20,8,12]], outfit);
  fill(20, 20, 8, 2, trim); fill(20, 27, 8, 2, id === 'knight' ? '#171b22' : outfit);
  fill(22, 23, 4, 3, id === 'grom' ? '#6e35a6' : id === 'ice' ? '#3985b3' : id === 'knight' ? '#717d91' : outfit);
  // Right arm base.
  faces([[44,16,4,4],[48,16,4,4],[40,20,4,12],[44,20,4,12],[48,20,4,12],[52,20,4,12]], outfit);
  fill(44, 20, 4, 2, trim); fill(44, 29, 4, 3, id === 'knight' ? '#6b7483' : outfit);
  // Left arm base (slim/classic map area in modern 64x64 texture).
  faces([[36,48,4,4],[40,48,4,4],[32,52,4,12],[36,52,4,12],[40,52,4,12],[44,52,4,12]], outfit);
  fill(36, 52, 4, 2, trim); fill(36, 61, 4, 3, outfit);
  // Right leg base.
  faces([[4,16,4,4],[8,16,4,4],[0,20,4,12],[4,20,4,12],[8,20,4,12],[12,20,4,12]], id === 'creeper' ? outfit : '#272b39');
  fill(4, 20, 4, 3, trim); fill(4, 28, 4, 4, id === 'knight' ? '#555f71' : '#202432');
  // Left leg base.
  faces([[20,48,4,4],[24,48,4,4],[16,52,4,12],[20,52,4,12],[24,52,4,12],[28,52,4,12]], id === 'creeper' ? outfit : '#272b39');
  fill(20, 20 + 32, 4, 3, trim); fill(20, 60, 4, 4, id === 'knight' ? '#555f71' : '#202432');
  // Simple transparent overlays keep the texture valid while the base layer stays editable.
  return c.toDataURL('image/png');
}

function pixelFromPointer(canvas: HTMLCanvasElement, event: React.PointerEvent<HTMLCanvasElement>) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: Math.max(0, Math.min(63, Math.floor(((event.clientX - rect.left) / rect.width) * 64))),
    y: Math.max(0, Math.min(63, Math.floor(((event.clientY - rect.top) / rect.height) * 64))),
  };
}

export default function SkinStudio({ accountType }: { accountType: 'offline' | 'microsoft' }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const [skinUrl, setSkinUrl] = useState<string | null>(null);
  const [color, setColor] = useState('#c084fc');
  const [eraser, setEraser] = useState(false);
  const [variant, setVariant] = useState<Variant>('classic');
  const [busy, setBusy] = useState(false);
  const [elyNickname, setElyNickname] = useState('');
  const [notice, setNotice] = useState('');

  const loadTexture = useCallback((url: string) => {
    const img = new Image();
    img.onload = () => {
      if (img.naturalWidth !== 64 || img.naturalHeight !== 64) {
        setNotice('Скин должен быть PNG 64×64. Старые 64×32 сначала преобразуй в редакторе.');
        return;
      }
      const canvas = canvasRef.current;
      const ctx = canvas?.getContext('2d');
      if (!canvas || !ctx) return;
      ctx.clearRect(0, 0, 64, 64);
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(img, 0, 0, 64, 64);
      setSkinUrl(url);
      setNotice('');
    };
    img.onerror = () => setNotice('Не удалось открыть это изображение. Выбери PNG-скин.');
    img.src = url;
  }, []);

  useEffect(() => {
    let alive = true;
    window.grom.loadSavedFile('skin').then((saved) => {
      if (!alive) return;
      loadTexture(saved || makePreset('grom'));
    }).catch(() => { if (alive) loadTexture(makePreset('grom')); });
    return () => { alive = false; };
  }, [loadTexture]);

  const paint = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    const { x, y } = pixelFromPointer(canvas, event);
    if (eraser) ctx.clearRect(x, y, 1, 1);
    else { ctx.fillStyle = color; ctx.fillRect(x, y, 1, 1); }
  };

  const commitPaint = () => {
    drawing.current = false;
    if (canvasRef.current) setSkinUrl(canvasRef.current.toDataURL('image/png'));
  };

  const choosePreset = (id: PresetKey) => loadTexture(makePreset(id));

  const handleImport = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (file.size > 256 * 1024 || !file.type.includes('png')) {
      setNotice('Выбери PNG не больше 256 КБ.');
      event.target.value = '';
      return;
    }
    const reader = new FileReader();
    reader.onload = () => { if (typeof reader.result === 'string') loadTexture(reader.result); };
    reader.readAsDataURL(file);
    event.target.value = '';
  };

  const handleSave = async () => {
    if (!canvasRef.current) return;
    setBusy(true); setNotice('');
    try {
      const result = await window.grom.saveSkinData(canvasRef.current.toDataURL('image/png'));
      if (!result.success || !result.dataUrl) throw new Error(result.error || 'Не удалось сохранить скин.');
      setSkinUrl(result.dataUrl);
      const cloud = await publishSkin(result.dataUrl);
      const cloudNote = cloud.ok ? ' Скин опубликован — другие игроки Grom увидят его в игре (Fabric/Forge).' : ` Не опубликован для других игроков: ${cloud.error}`;
      if (accountType === 'microsoft') {
        setNotice('Скин сохранён. Применяем его к профилю Minecraft…');
        const applied = await window.grom.applyMinecraftSkin(variant);
        if (!applied.success) throw new Error(`Скин сохранён локально, но Minecraft не принял его: ${applied.error || 'неизвестная ошибка'}`);
        setNotice('Готово! Скин применён к официальному профилю Minecraft. Если игра уже запущена, перезапусти её.');
      } else {
        setNotice(`Скин сохранён.${cloudNote}`);
      }
    } catch (e: any) { setNotice(e?.message || 'Ошибка сохранения.'); }
    finally { setBusy(false); }
  };

  const handleApply = async () => {
    if (!canvasRef.current) return;
    setBusy(true); setNotice('Сохраняем и отправляем скин в Minecraft…');
    try {
      const saved = await window.grom.saveSkinData(canvasRef.current.toDataURL('image/png'));
      if (!saved.success) throw new Error(saved.error || 'Не удалось сохранить скин.');
      const applied = await window.grom.applyMinecraftSkin(variant);
      if (!applied.success) throw new Error(applied.error || 'Не удалось применить скин.');
      setNotice('Готово! Скин обновлён в профиле Minecraft. Может понадобиться перезапустить игру.');
    } catch (e: any) { setNotice(e?.message || 'Не удалось применить скин.'); }
    finally { setBusy(false); }
  };

  const handleElyLookup = async () => {
    const nick = elyNickname.trim();
    if (!/^[A-Za-z0-9_]{1,16}$/.test(nick)) { setNotice('Ник Ely.by: от 1 до 16 латинских букв, цифр или _ .'); return; }
    setBusy(true); setNotice('Ищем скин…');
    try {
      const result = await window.grom.downloadElySkin(nick);
      if (!result.success) throw new Error(result.error || 'Скин не найден.');
      const saved = await window.grom.loadSavedFile('skin');
      if (saved) loadTexture(saved);
      setNotice(`Скин пользователя ${nick} загружен. Нажми «Сохранить скин», чтобы оставить его в редакторе.`);
    } catch (e: any) { setNotice(e?.message || 'Не удалось загрузить скин.'); }
    finally { setBusy(false); }
  };

  const handleExport = () => {
    if (!canvasRef.current) return;
    const link = document.createElement('a');
    link.download = 'grom-skin.png';
    link.href = canvasRef.current.toDataURL('image/png');
    link.click();
  };

  return (
    <section className="skin-studio-page">
      <header className="skin-studio-header">
        <div><span className="section-overline">ПЕРСОНАЛИЗАЦИЯ</span><h1>Скины</h1><p>Выбери образ, раскрась каждый пиксель и посмотри результат в 3D.</p></div>
        <span className="skin-studio-chip">64 × 64 PX</span>
      </header>

      {notice && <div className={`skin-studio-notice ${notice.startsWith('Готово') || notice.startsWith('Скин сохранён') ? 'success' : ''}`}>{notice}</div>}

      <div className="skin-studio-layout">
        <div className="skin-studio-main-column">
          <section className="skin-studio-panel">
            <div className="skin-studio-panel-heading"><div><h2>Каталог образов</h2><p>Нажми на вариант, чтобы начать редактирование.</p></div><span>{PRESETS.length} образов</span></div>
            <div className="skin-preset-grid">
              {PRESETS.map((preset) => (
                <button key={preset.id} className="skin-preset-card" onClick={() => choosePreset(preset.id)}>
                  <span className="skin-preset-icon" style={{ background: `linear-gradient(145deg, ${preset.main}, ${preset.accent})` }}><span>◈</span></span>
                  <span className="skin-preset-text"><strong>{preset.name}</strong><small>{preset.description}</small></span>
                  <span className="skin-preset-arrow">↗</span>
                </button>
              ))}
            </div>
            <div className="skin-ely-search">
              <div><strong>Загрузить существующий скин</strong><small>Найти скин по нику на Ely.by</small></div>
              <div className="skin-ely-controls"><input value={elyNickname} onChange={(e) => setElyNickname(e.target.value)} placeholder="Ник игрока" maxLength={16} /><button onClick={handleElyLookup} disabled={busy}>Найти</button></div>
            </div>
          </section>

          <section className="skin-studio-panel skin-editor-panel">
            <div className="skin-studio-panel-heading"><div><h2>Пиксельный редактор</h2><p>Зажми левую кнопку мыши и рисуй по текстуре.</p></div><span>Режим: {eraser ? 'ластик' : 'кисть'}</span></div>
            <div className="skin-editor-workspace">
              <div className="skin-texture-wrap"><div className="skin-texture-grid"><canvas ref={canvasRef} width={64} height={64} onPointerDown={(e) => { drawing.current = true; e.currentTarget.setPointerCapture(e.pointerId); paint(e); }} onPointerMove={(e) => { if (drawing.current && e.buttons !== 0) paint(e); }} onPointerUp={commitPaint} onPointerCancel={commitPaint} onLostPointerCapture={commitPaint} aria-label="Редактор пиксельного скина" /></div><small>Текстура 64×64 · PNG</small></div>
              <div className="skin-tools">
                <label className="skin-color-picker"><span>Цвет кисти</span><input type="color" value={color} onChange={(e) => { setColor(e.target.value); setEraser(false); }} /></label>
                <div className="skin-palette-title">ПАЛИТРА</div>
                <div className="skin-color-palette">{['#101014','#262331','#4b286d','#8b4dd6','#c084fc','#f0abfc','#ffffff','#dadce5','#8f98a9','#3a779b','#56b9e6','#9cf0ef','#4c8e45','#8ed16d','#ddad85','#6b4030'].map((hex) => <button key={hex} title={hex} aria-label={`Цвет ${hex}`} className={color.toLowerCase() === hex ? 'selected' : ''} style={{ backgroundColor: hex }} onClick={() => { setColor(hex); setEraser(false); }} />)}</div>
                <button className={`skin-tool-button ${!eraser ? 'active' : ''}`} onClick={() => setEraser(false)}>✎ Кисть</button>
                <button className={`skin-tool-button ${eraser ? 'active' : ''}`} onClick={() => setEraser(true)}>⌫ Ластик</button>
                <button className="skin-tool-button" onClick={() => loadTexture(makePreset('grom'))}>↺ Сбросить</button>
              </div>
            </div>
            <div className="skin-editor-actions"><button className="skin-secondary-action" onClick={() => fileRef.current?.click()}>＋ Импорт PNG</button><input ref={fileRef} type="file" accept="image/png" onChange={handleImport} hidden /><button className="skin-secondary-action" onClick={handleExport}>↓ Экспорт PNG</button><button className="skin-primary-action" onClick={handleSave} disabled={busy}>Сохранить скин</button></div>
          </section>
        </div>

        <aside className="skin-studio-preview-column">
          <section className="skin-studio-preview-card">
            <div className="skin-preview-topline"><span className="skin-preview-live-dot" /> ПРЕДПРОСМОТР</div>
            <div className="skin-preview-stage"><SkinViewer skinUrl={skinUrl} width={280} height={340} /></div>
            <h2>Твой персонаж</h2><p>3D-модель обновляется после рисования.</p>
            <div className="skin-variant-toggle"><button className={variant === 'classic' ? 'active' : ''} onClick={() => setVariant('classic')}>Classic</button><button className={variant === 'slim' ? 'active' : ''} onClick={() => setVariant('slim')}>Slim / Alex</button></div>
            <div className="skin-preview-divider" />
            {accountType === 'microsoft' ? (
              <><div className="skin-ms-connected"><span>✓</span><div><strong>Microsoft подключён</strong><small>Скин можно установить в профиль Minecraft.</small></div></div><button className="skin-primary-action skin-apply-action" onClick={handleApply} disabled={busy}>{busy ? 'Применение…' : 'Применить к аккаунту'}</button></>
            ) : (
              <div className="skin-ms-required"><strong>Нужен Microsoft-аккаунт</strong><p>Локальный скин сохранится на компьютере. Чтобы он отображался на серверах, войди в Microsoft и примени его к профилю Minecraft.</p></div>
            )}
          </section>
          <div className="skin-studio-tip"><span>✦</span><p><strong>Подсказка</strong> В Microsoft-режиме кнопка «Сохранить скин» также отправляет его в официальный профиль. В локальном режиме PNG хранится только на компьютере.</p></div>
        </aside>
      </div>
    </section>
  );
}
