import { useEffect, useMemo, useState } from 'react';
import { toast } from './Toast';

interface Session { version: string; loader: string; startedAt: string; durationMs?: number; exitCode?: number; instance?: string; server?: string; peakRamMb?: number; loadMs?: number }
interface StatsData {
  launches: number; totalDurationMs: number; sessions: Session[]; byDay: Record<string, number>; byVersion: Record<string, number>;
  byInstance: Record<string, number>; byServer: Record<string, number>; hours: number[]; streak: number; longestMs: number;
  avgPeakRamMb: number; avgLoadMs: number; crashes: number;
}

const fmt = (ms: number) => { const m = Math.round(ms / 60000); return m >= 60 ? `${Math.floor(m / 60)} ч ${m % 60} мин` : `${m} мин`; };
const key = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const top = (o: Record<string, number>, n = 5) => Object.entries(o).sort((a, b) => b[1] - a[1]).slice(0, n);

function Bars({ data }: { data: [string, number][] }) {
  const max = Math.max(1, ...data.map((d) => d[1]));
  if (!data.length) return <p className="hint">Пока нет данных</p>;
  return <div className="bars">{data.map(([k, v]) => (
    <div className="bar-row" key={k}><span className="bar-label" title={k}>{k}</span><div className="bar-track"><div style={{ width: `${(v / max) * 100}%` }} /></div><span className="bar-val">{fmt(v)}</span></div>
  ))}</div>;
}

function drawWrapped(s: StatsData, nick: string, year: number) {
  const c = document.createElement('canvas'); c.width = 1080; c.height = 1350;
  const g = c.getContext('2d')!;
  const css = getComputedStyle(document.documentElement);
  const accent = css.getPropertyValue('--accent').trim() || '#ff6a1f';
  g.fillStyle = '#0f1013'; g.fillRect(0, 0, c.width, c.height);
  g.fillStyle = accent; g.fillRect(0, 0, 14, c.height);
  g.fillStyle = '#85878f'; g.font = '600 34px Inter, sans-serif'; g.fillText('GROM CLIENT · ИТОГИ', 80, 120);
  g.fillStyle = '#ececee'; g.font = '800 120px Inter, sans-serif'; g.fillText(String(year), 80, 260);
  g.font = '600 44px Inter, sans-serif'; g.fillText(nick || 'Игрок', 80, 330);
  const yearMs = Object.entries(s.byDay).filter(([d]) => d.startsWith(String(year))).reduce((n, [, v]) => n + v, 0);
  const days = Object.keys(s.byDay).filter((d) => d.startsWith(String(year))).length;
  const favV = top(s.byVersion, 1)[0]?.[0] || '—';
  const rows: [string, string][] = [['Сыграно', fmt(yearMs)], ['Дней в игре', String(days)], ['Лучшая серия', `${s.streak} дн.`], ['Самая длинная сессия', fmt(s.longestMs)], ['Любимая версия', favV]];
  rows.forEach(([k, v], i) => {
    const y = 470 + i * 150;
    g.fillStyle = '#85878f'; g.font = '500 32px Inter, sans-serif'; g.fillText(k, 80, y);
    g.fillStyle = i === 0 ? accent : '#ececee'; g.font = '800 64px Inter, sans-serif'; g.fillText(v, 80, y + 66);
  });
  g.fillStyle = '#85878f'; g.font = '500 28px Inter, sans-serif'; g.fillText('gromclient.devs.li', 80, 1290);
  const a = document.createElement('a'); a.href = c.toDataURL('image/png'); a.download = `grom-итоги-${year}.png`; a.click();
  toast('Картинка сохранена');
}

export default function Stats({ nickname }: { nickname: string }) {
  const [s, setS] = useState<StatsData | null>(null);
  useEffect(() => { window.grom.stats().then(setS); }, []);

  const heat = useMemo(() => {
    const cells: { k: string; v: number }[] = []; const end = new Date(); const start = new Date(end); start.setDate(end.getDate() - (26 * 7 - 1) - ((end.getDay() + 6) % 7 === 0 ? 0 : 0));
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) cells.push({ k: key(d), v: s?.byDay[key(d)] || 0 });
    return cells;
  }, [s]);

  if (!s) return <div className="feat-page"><h1>Статистика</h1><p className="hint">Загрузка…</p></div>;
  const lvl = (v: number) => (v === 0 ? 0 : v < 30 * 60000 ? 1 : v < 2 * 3600000 ? 2 : v < 4 * 3600000 ? 3 : 4);
  const maxH = Math.max(1, ...s.hours);

  return (
    <div className="feat-page">
      <div className="feat-head"><h1>Статистика</h1><button className="small-button primary" onClick={() => drawWrapped(s, nickname, new Date().getFullYear())}>Итоги года → PNG</button></div>
      <div className="kpi-grid">
        {[['Всего в игре', fmt(s.totalDurationMs)], ['Запусков', String(s.launches)], ['Серия дней', String(s.streak)], ['Рекорд сессии', fmt(s.longestMs)],
          ['Загрузка игры', s.avgLoadMs ? `${Math.round(s.avgLoadMs / 1000)} с` : '—'], ['Пик RAM (ср.)', s.avgPeakRamMb ? `${(s.avgPeakRamMb / 1024).toFixed(1)} ГБ` : '—'], ['Вылеты', String(s.crashes)]].map(([k, v]) => (
          <div className="glass-card kpi" key={k}><small>{k}</small><strong>{v}</strong></div>
        ))}
      </div>
      <section className="glass-card"><h2>Активность · 26 недель</h2><div className="heat">{heat.map((c) => <i key={c.k} className={`h${lvl(c.v)}`} title={`${c.k}: ${c.v ? fmt(c.v) : 'не играл'}`} />)}</div></section>
      <div className="feat-grid">
        <section className="glass-card"><h2>Версии</h2><Bars data={top(s.byVersion)} /></section>
        <section className="glass-card"><h2>Сборки</h2><Bars data={top(s.byInstance)} /></section>
        <section className="glass-card"><h2>Серверы</h2><Bars data={top(s.byServer)} /></section>
        <section className="glass-card"><h2>Время суток</h2><div className="hours">{s.hours.map((h, i) => <div key={i} title={`${i}:00 — ${fmt(h)}`}><i style={{ height: `${(h / maxH) * 100}%` }} /><small>{i % 6 === 0 ? i : ''}</small></div>)}</div></section>
      </div>
      <section className="glass-card"><h2>Последние сессии</h2>
        <div className="sess">{s.sessions.slice(0, 12).map((r, i) => (
          <div className="sess-row" key={i}>
            <span>{new Date(r.startedAt).toLocaleString('ru-RU', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>
            <span>{r.loader} {r.version}{r.instance ? ` · ${r.instance}` : ''}</span>
            <span>{r.durationMs ? fmt(r.durationMs) : 'идёт…'}</span>
            <span>{r.peakRamMb ? `${(r.peakRamMb / 1024).toFixed(1)} ГБ` : ''}</span>
            <span className={r.exitCode ? 'bad' : ''}>{r.exitCode ? `код ${r.exitCode}` : ''}</span>
          </div>))}
        </div>
      </section>
    </div>
  );
}
