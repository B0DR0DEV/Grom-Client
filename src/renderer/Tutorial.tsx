import { useState } from 'react';

interface TutorialProps {
  onDone: () => void;
}

const steps = [
  {
    icon: '🎮',
    title: 'Добро пожаловать в GROM!',
    text: 'Это твой лаунчер для Minecraft. Давай покажу, что тут есть.',
  },
  {
    icon: '🏠',
    title: 'Главная',
    text: 'Здесь выбираешь версию, загружаешь скин и жмёшь ИГРАТЬ. Java и Minecraft скачаются автоматически.',
  },
  {
    icon: '🧩',
    title: 'Моды и Сборки',
    text: 'Ищи моды через Modrinth, создавай сборки, скачивай готовые. Всё в пару кликов.',
  },
  {
    icon: '💬',
    title: 'Мессенджер',
    text: 'Общайся с друзьями, кидай файлы, звони. Всё внутри лаунчера.',
  },
  {
    icon: '🌐',
    title: 'Сервер',
    text: 'Поднимай сервер на своём компе и играй с друзьями. Не забудь включить пиратский режим!',
  },
  {
    icon: '⌨️',
    title: 'Горячие клавиши',
    text: 'Ctrl+K — поиск. Ctrl+1..9 — быстрые вкладки. Всё для удобства.',
  },
];

export default function Tutorial({ onDone }: TutorialProps) {
  const [step, setStep] = useState(0);
  const current = steps[step];

  const next = () => {
    if (step < steps.length - 1) setStep(step + 1);
    else onDone();
  };

  const skip = () => onDone();

  return (
    <div className="tutorial-overlay">
      <div className="tutorial-card">
        <div className="tutorial-progress">
          {steps.map((_, i) => (
            <div key={i} className={`tutorial-dot ${i === step ? 'active' : ''} ${i < step ? 'done' : ''}`} />
          ))}
        </div>

        <div className="tutorial-icon">{current.icon}</div>
        <h2>{current.title}</h2>
        <p>{current.text}</p>

        <div className="tutorial-buttons">
          <button className="small-button" onClick={skip}>Пропустить</button>
          <button className="play-button" onClick={next}>
            {step < steps.length - 1 ? 'Далее →' : 'Начать! 🚀'}
          </button>
        </div>
      </div>
    </div>
  );
}