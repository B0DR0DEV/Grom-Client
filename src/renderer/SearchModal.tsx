import { useState, useEffect, useRef } from 'react';

interface SearchModalProps {
  onClose: () => void;
  onNavigate: (page: string) => void;
}

interface SearchItem {
  type: 'page' | 'action' | 'preset';
  title: string;
  subtitle: string;
  icon: string;
  action: () => void;
}

export default function SearchModal({ onClose, onNavigate }: SearchModalProps) {
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const items: SearchItem[] = [
    { type: 'page', title: 'Главная', subtitle: 'Запуск Minecraft', icon: '🏠', action: () => { onNavigate('home'); onClose(); } },
    { type: 'page', title: 'Новости', subtitle: 'Что нового', icon: '📰', action: () => { onNavigate('news'); onClose(); } },
    { type: 'page', title: 'Моды', subtitle: 'Поиск и установка', icon: '🧩', action: () => { onNavigate('mods'); onClose(); } },
    { type: 'page', title: 'Сборки', subtitle: 'Инстансы и модпаки', icon: '📦', action: () => { onNavigate('modpacks'); onClose(); } },
    { type: 'page', title: 'Сервер', subtitle: 'Игра с другом', icon: '🌐', action: () => { onNavigate('server'); onClose(); } },
    { type: 'page', title: 'Визуалы', subtitle: 'Раздел в разработке', icon: '✨', action: () => { onNavigate('visuals'); onClose(); } },
    { type: 'page', title: 'Настройки', subtitle: 'Темы, шрифты, ОЗУ', icon: '⚙️', action: () => { onNavigate('settings'); onClose(); } },
    { type: 'page', title: 'О нас', subtitle: 'Информация', icon: 'ℹ️', action: () => { onNavigate('about'); onClose(); } },
    { type: 'action', title: 'Проверить обновления Java', subtitle: 'Найти Java в системе', icon: '☕', action: () => { window.location.reload(); } },
    { type: 'action', title: 'Открыть папку игры', subtitle: 'Проводник Windows', icon: '📁', action: () => { window.grom.openFolder('game'); onClose(); } },
  ];

  const filtered = query
    ? items.filter((i) => i.title.toLowerCase().includes(query.toLowerCase()) || i.subtitle.toLowerCase().includes(query.toLowerCase()))
    : items;

  const handleKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelected((s) => Math.min(s + 1, filtered.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelected((s) => Math.max(s - 1, 0));
    } else if (e.key === 'Enter') {
      filtered[selected]?.action();
    } else if (e.key === 'Escape') {
      onClose();
    }
  };

  return (
    <div className="search-modal-overlay" onClick={onClose}>
      <div className="search-modal" onClick={(e) => e.stopPropagation()}>
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => { setQuery(e.target.value); setSelected(0); }}
          onKeyDown={handleKey}
          placeholder="Поиск по лаунчеру..."
          className="search-input"
        />
        <div className="search-results">
          {filtered.length === 0 && <div className="search-empty">Ничего не найдено</div>}
          {filtered.map((item, i) => (
            <div
              key={i}
              className={`search-item ${i === selected ? 'selected' : ''}`}
              onClick={item.action}
              onMouseEnter={() => setSelected(i)}
            >
              <span className="search-item-icon">{item.icon}</span>
              <div>
                <div className="search-item-title">{item.title}</div>
                <div className="search-item-subtitle">{item.subtitle}</div>
              </div>
            </div>
          ))}
        </div>
        <div className="search-footer">
          <span>↑↓ — навигация</span>
          <span>Enter — открыть</span>
          <span>Esc — закрыть</span>
        </div>
      </div>
    </div>
  );
}