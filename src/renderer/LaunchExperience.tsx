import stormBackground from '../../assets/backgrounds/bg-storm.png';
import BrandIcon from './BrandIcon';

type LaunchExperienceProps = {
  progress: number;
  message: string;
  version: string;
  loader: string;
  nickname: string;
  operation: 'launch' | 'java' | 'loader';
  appIcon?: string;
  theme?: string;
};

const launchStages = [
  { title: 'Проверка Java', hint: 'Среда выполнения' },
  { title: 'Файлы игры', hint: 'Клиент и ресурсы' },
  { title: 'Подготовка', hint: 'Библиотеки и моды' },
  { title: 'Запуск', hint: 'Создание процесса' },
];
const javaStages = [
  { title: 'Манифест', hint: 'Поиск runtime' },
  { title: 'Загрузка Java', hint: 'Файлы среды' },
  { title: 'Проверка', hint: 'Подготовка runtime' },
  { title: 'Готово', hint: 'Java установлена' },
];
const loaderStages = [
  { title: 'Подключение', hint: 'Каталог загрузчика' },
  { title: 'Загрузка', hint: 'Профиль версии' },
  { title: 'Установка', hint: 'Конфигурация' },
  { title: 'Готово', hint: 'Можно играть' },
];

function getStageIndex(message: string, progress: number, operation: 'launch' | 'java' | 'loader'): number {
  if (operation === 'java') {
    if (progress >= 100) return 3;
    if (/манифест|получение/i.test(message) || progress < 5) return 0;
    if (progress < 90) return 1;
    return 2;
  }
  if (operation === 'loader') {
    if (progress >= 100) return 3;
    if (/получение списка|подключение/i.test(message) || progress < 10) return 0;
    if (progress < 35) return 1;
    return 2;
  }
  const text = message.toLocaleLowerCase('ru-RU');
  if (/запуск игры|игра запущена/.test(text)) return 3;
  if (/подготовка версии|проверка библиотек|распаков|нативн/.test(text)) return 2;
  if (/получение данных версии|скачивание клиента|скачивание библиотек|библиотеки:|скачивание ресурсов|ассеты:|списка ассетов|minecraft .* установлен|fabric|forge|установка/.test(text)) return 1;
  if (/java|runtime|манифест/.test(text)) return 0;
  if (progress >= 92) return 3;
  if (progress >= 76) return 2;
  if (progress >= 15) return 1;
  return 0;
}

export default function LaunchExperience({ progress, message, version, loader, nickname, operation, appIcon, theme }: LaunchExperienceProps) {
  const value = Math.max(0, Math.min(100, Math.round(progress || 0)));
  const stages = operation === 'java' ? javaStages : operation === 'loader' ? loaderStages : launchStages;
  const activeStage = getStageIndex(message, value, operation);
  const finished = operation === 'launch' ? value >= 100 || /игра запущена/i.test(message) : value >= 100;
  const completionLabel = operation === 'launch' ? 'ПЕРЕДАЧА УПРАВЛЕНИЯ' : 'ОПЕРАЦИЯ ЗАВЕРШЕНА';
  const taskLabel = operation === 'java' ? 'УСТАНОВКА JAVA RUNTIME' : operation === 'loader' ? 'УСТАНОВКА ЗАГРУЗЧИКА' : 'ПОДГОТОВКА ИГРЫ';
  const taskDescription = operation === 'java'
    ? 'Загружаем подходящую версию Java и подготавливаем среду выполнения для Minecraft.'
    : operation === 'loader'
      ? `Подготавливаем профиль ${loader} для Minecraft ${version} и проверяем совместимость файлов.`
      : 'Проверяем файлы, подготавливаем окружение и собираем всё необходимое для запуска Minecraft.';

  return (
    <section
      className="launch-experience"
      role="dialog"
      aria-modal="true"
      aria-label={operation === 'java' ? 'Установка Java' : operation === 'loader' ? 'Установка загрузчика' : 'Загрузка Minecraft'}
      style={{ backgroundImage: `linear-gradient(90deg, rgba(7, 9, 13, .96) 0%, rgba(7, 9, 13, .84) 47%, rgba(7, 9, 13, .64) 100%), linear-gradient(0deg, rgba(7,9,13,.96) 0%, transparent 62%), url("${stormBackground}")` }}
    >
      <div className="launch-exp-grid" aria-hidden="true" />
      <div className="launch-exp-ambient launch-exp-ambient-one" aria-hidden="true" />
      <div className="launch-exp-ambient launch-exp-ambient-two" aria-hidden="true" />

      <header className="launch-exp-header">
        <div className="launch-exp-brand">
          <BrandIcon iconKey={appIcon} theme={theme} className="launch-exp-logo" />
          <span><strong>GROM</strong><small>CLIENT / LAUNCH SYSTEM</small></span>
        </div>
        <div className="launch-exp-header-status"><span className="launch-exp-live-dot" />{finished ? completionLabel : 'СИСТЕМА ЗАПУСКА АКТИВНА'}</div>
      </header>

      <div className="launch-exp-main">
        <div className="launch-exp-copy">
          <div className="launch-exp-overline"><span>01</span> {taskLabel} <i /></div>
          <h1>ТВОЙ МИР<br /><em>ЖДЁТ.</em></h1>
          <p className="launch-exp-description">{taskDescription}</p>
          <div className="launch-exp-tags">
            <span><small>ВЕРСИЯ</small><strong>{version}</strong></span>
            <span><small>ЗАГРУЗЧИК</small><strong>{loader}</strong></span>
            <span><small>ПРОФИЛЬ</small><strong>{nickname || 'Игрок'}</strong></span>
          </div>
        </div>

        <div className="launch-exp-emblem" aria-hidden="true">
          <div className="launch-exp-emblem-orbit launch-exp-emblem-orbit-a" />
          <div className="launch-exp-emblem-orbit launch-exp-emblem-orbit-b" />
          <div className="launch-exp-emblem-core"><BrandIcon iconKey={appIcon} theme={theme} className="launch-exp-emblem-image" /></div>
          <div className="launch-exp-emblem-caption"><span>GC / 001</span><span>{operation === 'launch' ? 'WORLD INITIALIZATION' : 'RUNTIME INITIALIZATION'}</span></div>
        </div>
      </div>

      <footer className="launch-exp-footer">
        <div className="launch-exp-progress-head">
          <div className="launch-exp-current-task">
            <span className={`launch-exp-task-icon ${finished ? 'is-done' : ''}`} aria-hidden="true">{finished ? '✓' : <span />}</span>
            <div><small>{finished ? 'ГОТОВО' : 'ТЕКУЩАЯ ОПЕРАЦИЯ'}</small><strong>{message || 'Подготовка запуска...'}</strong></div>
          </div>
          <div className="launch-exp-progress-number"><strong>{value}<small>%</small></strong><span>{finished ? 'готово' : 'выполнено'}</span></div>
        </div>
        <div className="launch-exp-track" aria-label={`Прогресс ${value}%`} role="progressbar" aria-valuenow={value} aria-valuemin={0} aria-valuemax={100}>
          <div className="launch-exp-track-fill" style={{ width: `${value}%` }} />
          <div className="launch-exp-track-glint" />
        </div>
        <div className="launch-exp-steps">
          {stages.map((stage, index) => {
            const state = index < activeStage || finished ? 'complete' : index === activeStage ? 'active' : 'pending';
            return (
              <div className={`launch-exp-step ${state}`} key={stage.title}>
                <span className="launch-exp-step-mark">{state === 'complete' ? '✓' : `0${index + 1}`}</span>
                <span className="launch-exp-step-copy"><strong>{stage.title}</strong><small>{stage.hint}</small></span>
              </div>
            );
          })}
        </div>
        <div className="launch-exp-footnote"><span><i /> НЕ ЗАКРЫВАЙ ЛАУНЧЕР ВО ВРЕМЯ ПОДГОТОВКИ</span><span>GROM CLIENT <b>•</b> MINECRAFT JAVA EDITION</span></div>
      </footer>
    </section>
  );
}
