import { useEffect, useRef, useState } from 'react';

function ansiToHtml(text: string): string {
  let html = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  const colors: Record<string, string> = {
    '30': '#0a0a0c', '31': '#ef4444', '32': '#4ade80', '33': '#facc15',
    '34': '#60a5fa', '35': '#c084fc', '36': '#22d3ee', '37': '#e8e8ea',
    '90': '#6a6a72', '91': '#ff8540', '92': '#6ee7a0', '93': '#fde047',
    '94': '#93c5fd', '95': '#d8b4fe', '96': '#67e8f9', '97': '#ffffff',
  };

  const parts: { text: string; color?: string; bold?: boolean; dim?: boolean }[] = [];
  let current = '';
  let currentColor: string | undefined;
  let currentBold = false;
  let currentDim = false;

  let i = 0;
  while (i < html.length) {
    if (html[i] === '\x1b' || html.charCodeAt(i) === 27) {
      if (current) {
        parts.push({ text: current, color: currentColor, bold: currentBold, dim: currentDim });
        current = '';
      }
      const match = html.slice(i).match(/^\x1b\[([0-9;]*)m/);
      if (match) {
        const codes = match[1].split(';');
        for (const code of codes) {
          if (code === '0' || code === '') {
            currentColor = undefined;
            currentBold = false;
            currentDim = false;
          } else if (code === '1') {
            currentBold = true;
          } else if (code === '2') {
            currentDim = true;
          } else if (colors[code]) {
            currentColor = colors[code];
          }
        }
        i += match[0].length;
        continue;
      }
      const otherMatch = html.slice(i).match(/^\x1b\[[0-9;]*[A-Za-z]/);
      if (otherMatch) {
        i += otherMatch[0].length;
        continue;
      }
      i++;
      continue;
    }

    current += html[i];
    i++;
  }

  if (current) {
    parts.push({ text: current, color: currentColor, bold: currentBold, dim: currentDim });
  }

  return parts.map(p => {
    const styles: string[] = [];
    if (p.color) styles.push(`color:${p.color}`);
    if (p.bold) styles.push('font-weight:700');
    if (p.dim) styles.push('opacity:0.6');
    if (styles.length === 0) return p.text;
    return `<span style="${styles.join(';')}">${p.text}</span>`;
  }).join('');
}

interface TerminalProps {
  onBack: () => void;
  initialQuestion?: string;
}

export default function TerminalPage({ onBack, initialQuestion }: TerminalProps) {
  const [lines, setLines] = useState<string[]>([]);
  const [input, setInput] = useState('');
  const [status, setStatus] = useState<'starting' | 'running' | 'stopped' | 'error'>('starting');
  const [errorMsg, setErrorMsg] = useState('');
  const [autoScroll, setAutoScroll] = useState(true);

  const outputRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const rawBufferRef = useRef<string>('');
  const renderRafRef = useRef<number | null>(null);
  const initialQuestionSentRef = useRef(false);

  const scheduleRender = () => {
    if (renderRafRef.current !== null) return;
    renderRafRef.current = requestAnimationFrame(() => {
      renderRafRef.current = null;
      const raw = rawBufferRef.current;
      const split = raw.split(/\r?\n/);
      setLines(split);
    });
  };

  useEffect(() => {
    const unsubData = window.grom.terminal.onData((data: string) => {
      let processed = data.replace(/\r\n/g, '\n');
      processed = processed.replace(/\r(?!\n)/g, '\n');
      rawBufferRef.current += processed;
      if (rawBufferRef.current.length > 500_000) {
        rawBufferRef.current = rawBufferRef.current.slice(-300_000);
      }
      scheduleRender();

      // Отправляем initialQuestion после первого этапа (когда появится "Ты:")
      if (initialQuestion && !initialQuestionSentRef.current) {
        // Ждём ~5 секунд, потом отправляем вопрос
        setTimeout(() => {
          if (!initialQuestionSentRef.current && initialQuestion.trim()) {
            initialQuestionSentRef.current = true;
            window.grom.terminal.write(initialQuestion.trim() + '\n');
            rawBufferRef.current += initialQuestion.trim() + '\n';
            scheduleRender();
          }
        }, 5000);
      }
    });

    const unsubExit = window.grom.terminal.onExit((code) => {
      setStatus('stopped');
      rawBufferRef.current += `\n\x1b[33m[Процесс завершён с кодом ${code}]\x1b[0m\n`;
      scheduleRender();
    });

    window.grom.terminal.spawn().then((res) => {
      if (!res.success) {
        setStatus('error');
        setErrorMsg(res.error || 'Не удалось запустить терминал');
        rawBufferRef.current += `\n\x1b[31m[Ошибка] ${res.error}\x1b[0m\n`;
        scheduleRender();
        return;
      }
      setStatus('running');
    });

    return () => {
      unsubData();
      unsubExit();
      if (renderRafRef.current) cancelAnimationFrame(renderRafRef.current);
    };
  }, []);

  useEffect(() => {
    if (autoScroll && outputRef.current) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight;
    }
  }, [lines, autoScroll]);

  const handleSend = () => {
    if (!input.trim()) return;
    window.grom.terminal.write(input + '\n');
    rawBufferRef.current += input + '\n';
    scheduleRender();
    setInput('');
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleSend();
    }
  };

  const handleScroll = () => {
    if (!outputRef.current) return;
    const el = outputRef.current;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 30;
    setAutoScroll(atBottom);
  };

  const handleClear = () => {
    rawBufferRef.current = '';
    setLines([]);
  };

  const handleRestart = async () => {
    window.grom.terminal.kill();
    rawBufferRef.current = '';
    setLines([]);
    setStatus('starting');
    setErrorMsg('');
    initialQuestionSentRef.current = false;
    setTimeout(async () => {
      const res = await window.grom.terminal.spawn();
      if (res.success) setStatus('running');
      else { setStatus('error'); setErrorMsg(res.error || ''); }
    }, 500);
  };

  const statusLabels: Record<string, string> = {
    starting: 'запуск...',
    running: 'работает',
    stopped: 'остановлен',
    error: 'ошибка',
  };

  return (
    <div className="terminal-page">
      <div className="terminal-header">
        <div className="terminal-header-left">
          <button className="terminal-back-button" onClick={onBack} title="Назад">
            ← Назад
          </button>
          <div className="terminal-title">
            <span className="terminal-dot" />
            <span>GROM AI — Терминал</span>
            <span className={`terminal-status terminal-status-${status}`}>
              {statusLabels[status]}
            </span>
          </div>
        </div>
        <div className="terminal-actions">
          <button className="small-button" onClick={handleClear}>Очистить</button>
          <button className="small-button" onClick={handleRestart}>Перезапустить</button>
        </div>
      </div>

      {errorMsg && (
        <div className="terminal-error">Ошибка: {errorMsg}</div>
      )}

      <div className="terminal-output" ref={outputRef} onScroll={handleScroll}>
        {lines.map((line, i) => (
          <div
            key={i}
            className="terminal-line"
            dangerouslySetInnerHTML={{ __html: ansiToHtml(line) || '&nbsp;' }}
          />
        ))}
      </div>

      <div className="terminal-input-row">
        <span className="terminal-prompt">&gt;</span>
        <input
          ref={inputRef}
          className="terminal-input"
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Введи вопрос или команду..."
          autoFocus
        />
        <button className="small-button" onClick={handleSend}>Отправить</button>
      </div>
    </div>
  );
}