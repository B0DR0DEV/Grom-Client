import { useState, useEffect, useRef } from 'react';
import Splash from './Splash';
import SkinViewer from './SkinViewer';
import SkinStudio from './SkinStudio';
import Messenger from './Messenger';
import CallModal from './CallModal';
import ImportModal from './ImportModal';

/** Звонки временно выключены. Чтобы вернуть — поставь true (и убери .call-button { display: none } в features.css). */
const CALLS_ENABLED = false;
import { publishSkin, syncSavedSkin } from './skinsCloud';
import { listenInbox, newRoomId, sendToInbox, startRingtone, RingPayload } from './callSignal';
import ProfileModal from './ProfileModal';
import AuthScreen from './AuthScreen';
import Tutorial from './Tutorial';
import Modal from './Modal';
import Pet from './Pet';
import TerminalPage from './Terminal';
import ToastContainer, { toast } from './Toast';
import { MOD_PRESETS, ModPreset } from './presets';
import heroBackground from '../../assets/backgrounds/bg-storm.png';
import WindowControls from './WindowControls';
import LaunchExperience from './LaunchExperience';
import BrandIcon from './BrandIcon';
import PlayTogether from './PlayTogether';
import Stats from './Stats';
import { supabase } from './supabaseClient';

type Page = 'home' | 'news' | 'addons' | 'modpacks' | 'worlds' | 'messenger' | 'ai' | 'skins' | 'settings' | 'about' | 'together' | 'stats';
type AddonTab = 'mod' | 'resourcepack' | 'shader';

type ModalField = {
  key: string;
  label: string;
  placeholder?: string;
  type?: 'text' | 'password' | 'select';
  options?: string[];
  default?: string;
};

type ModalOpener = (modal: {
  title: string;
  fields: ModalField[];
  confirmText?: string;
  onConfirm: (values: Record<string, string>) => void;
}) => void;

export default function App() {
  const [page, setPage] = useState<Page>('home');
  const [loading, setLoading] = useState(true);
  const [animKey, setAnimKey] = useState(0);
  const [config, setConfigState] = useState<GromConfig | null>(null);
  const [backgroundUrl, setBackgroundUrl] = useState<string>('');
  const [glass, setGlass] = useState<boolean>(() => localStorage.getItem('grom-glass') !== 'off');
  useEffect(() => { document.documentElement.dataset.glass = glass ? 'on' : 'off'; localStorage.setItem('grom-glass', glass ? 'on' : 'off'); }, [glass]);
  const [fontData, setFontData] = useState<FontItem | null>(null);
  const [buttonTexture, setButtonTexture] = useState<string | null>(null);
  const [navIcons, setNavIcons] = useState<Record<string, string>>({});
  const [instances, setInstances] = useState<Instance[]>([]);
  const [activeInstance, setActiveInstance] = useState<string>('');
  const [call, setCall] = useState<{ peer: { nickname: string; avatar: string | null }; role: 'caller' | 'callee'; room: string } | null>(null);
  const [incoming, setIncoming] = useState<RingPayload | null>(null);
  const callRef = useRef(call); callRef.current = call;
  const incomingRef = useRef(incoming); incomingRef.current = incoming;
  const [showProfile, setShowProfile] = useState(false);
  const [profileTarget, setProfileTarget] = useState<string | null>(null);
  const [pendingChatNickname, setPendingChatNickname] = useState<string | null>(null);
  const [authed, setAuthed] = useState(false);
  const [checkingAuth, setCheckingAuth] = useState(true);
  const [showTutorial, setShowTutorial] = useState(false);
  const [aiInitialQuestion, setAiInitialQuestion] = useState<string>('');

  const [modal, setModal] = useState<{
    title: string;
    fields: ModalField[];
    confirmText?: string;
    onConfirm: (values: Record<string, string>) => void;
  } | null>(null);

  useEffect(() => { if (authed && config?.accountType !== 'microsoft') void syncSavedSkin(); }, [authed]);

  // ── Звонки: личный канал входящих ──
  useEffect(() => {
    if (!CALLS_ENABLED || !authed || !config?.nickname) return;
    return listenInbox(config.nickname, {
      ring: (p) => {
        if (!p?.room || !p.from || Date.now() - (p.at || 0) > 45_000) return;
        if (callRef.current || (incomingRef.current && incomingRef.current.room !== p.room)) { sendToInbox(p.from, 'busy', { room: p.room }).catch(() => {}); return; }
        setIncoming(p);
      },
      cancel: (p) => { if (incomingRef.current?.room === p?.room) setIncoming(null); },
      decline: (p) => window.dispatchEvent(new CustomEvent('grom-call-signal', { detail: { type: 'decline', room: p?.room } })),
      busy: (p) => window.dispatchEvent(new CustomEvent('grom-call-signal', { detail: { type: 'busy', room: p?.room } })),
    });
  }, [authed, config?.nickname]);
  useEffect(() => {
    if (!incoming) return;
    const stop = startRingtone('incoming');
    const t = setTimeout(() => setIncoming(null), 45_000);
    return () => { stop(); clearTimeout(t); };
  }, [incoming?.room]);

  useEffect(() => {
    (async () => {
      const cfg = await window.grom.getConfig();
      setConfigState(cfg);
      if (cfg.background !== 'none') {
        const bgs = await window.grom.listBackgrounds();
        const found = bgs.find((b) => b.name === cfg.background);
        if (found) setBackgroundUrl(found.dataUrl);
      }
      if (cfg.customFontPath) {
        const font = await window.grom.loadSavedFont();
        if (font) { setFontData(font); injectFont(font); }
      }
      const tex = await window.grom.getButtonTexture();
      if (tex) setButtonTexture(tex);
      const icons = await window.grom.getNavIcons();
      setNavIcons(icons);
      const inst = await window.grom.listInstances();
      setInstances(inst);

      const savedNickname = localStorage.getItem('grom-login');
      if (savedNickname) {
        const accountType = localStorage.getItem('grom-account-type') === 'microsoft' ? 'microsoft' : 'offline';
        setConfigState((prev) => prev ? { ...prev, nickname: savedNickname, accountType } : prev);
        // Keep the renderer's remembered profile and Electron's persisted launch profile in sync.
        // Otherwise an old 'microsoft' config can survive after the UI restores an offline profile.
        void window.grom.setConfig('nickname', savedNickname);
        void window.grom.setConfig('accountType', accountType);
        setAuthed(true);
      }
      setCheckingAuth(false);

      const tutDone = localStorage.getItem('grom-tutorial-done');
      if (!tutDone) setShowTutorial(true);
    })();
  }, []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey) {
        if (e.key >= '1' && e.key <= '9') {
          e.preventDefault();
          const pages: Page[] = ['home', 'news', 'addons', 'modpacks', 'worlds', 'messenger', 'ai', 'skins', 'settings'];
          const idx = parseInt(e.key) - 1;
          if (pages[idx]) setPage(pages[idx]);
        }
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  useEffect(() => {
    if (buttonTexture) document.documentElement.style.setProperty('--button-texture', `url(${buttonTexture})`);
  }, [buttonTexture]);

  useEffect(() => { setAnimKey((k) => k + 1); }, [page]);

  const updateConfig = (key: keyof GromConfig, value: any) => {
    if (!config) return;
    setConfigState({ ...config, [key]: value });
    window.grom.setConfig(key, value);
  };

  const refreshInstances = async () => {
    const inst = await window.grom.listInstances();
    setInstances(inst);
  };

  useEffect(() => {
    if (!config) return;
    document.documentElement.setAttribute('data-theme', config.theme);
  }, [config?.theme]);

  useEffect(() => { if (fontData) injectFont(fontData); }, [fontData]);

  if (loading || !config || checkingAuth) return <><WindowControls mode="floating" /><Splash onDone={() => setLoading(false)} /></>;

  if (!authed) return <><WindowControls mode="floating" /><AuthScreen appIcon={config.appIcon} theme={config.theme} onAuth={(nick, accountType = 'offline') => {
    setConfigState((prev) => prev ? { ...prev, nickname: nick, accountType } : prev);
    void window.grom.setConfig('nickname', nick);
    void window.grom.setConfig('accountType', accountType);
    setAuthed(true);
  }} /></>;

  if (showTutorial) {
    return <><WindowControls mode="floating" /><Tutorial onDone={() => {
      localStorage.setItem('grom-tutorial-done', 'true');
      setShowTutorial(false);
    }} /></>;
  }

  const navItems: { key: Page; icon: string; label: string }[] = [
    { key: 'home', icon: 'home', label: 'Главная' },
    { key: 'news', icon: 'news', label: 'Новости' },
    { key: 'addons', icon: 'mods', label: 'Дополнения' },
    { key: 'modpacks', icon: 'modpacks', label: 'Сборки' },
    { key: 'worlds', icon: 'worlds', label: 'Миры' },
    { key: 'messenger', icon: 'messenger', label: 'Мессенджер' },
    { key: 'together', icon: 'together', label: 'Вместе' },
    { key: 'stats', icon: 'stats', label: 'Статистика' },
    { key: 'skins', icon: 'visuals', label: 'Скины' },
    { key: 'settings', icon: 'settings', label: 'Настройки' },
    { key: 'about', icon: 'about', label: 'О нас' },
  ];

  const openAI = (question: string = '') => {
    setAiInitialQuestion(question);
    setPage('ai');
  };

  return (
    <div className="app-wrapper">
      {(backgroundUrl || heroBackground) && (
        <div className="app-background" style={{ backgroundImage: `url(${backgroundUrl || heroBackground})`, filter: `blur(${config.blurAmount}px)` }} />
      )}
      <div className="app-overlay" style={{ opacity: 1 - config.panelOpacity / 100 }} />

      <Pet enabled={config.petEnabled} petType={config.petType} />

      <div className="app-vertical launcher-shell">
        <header className="top-bar launcher-topbar">
          <div className="top-logo launcher-wordmark">
            <BrandIcon iconKey={config.appIcon} theme={config.theme} className="logo-mark launcher-logo-mark" />
            <span className="launcher-wordmark-copy">
              <span className="logo-text">GROM</span>
              <span className="launcher-wordmark-subtitle">CLIENT</span>
            </span>
          </div>

          <WindowControls mode="embedded" />

          <div className="top-actions launcher-top-actions">
            <button className={`glass-toggle ${glass ? 'on' : ''}`} onClick={() => setGlass((g) => !g)} title={glass ? 'Стекло: вкл (нажми — плоский режим)' : 'Стекло: выкл'}><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round"><path d="M12 3l8 4.5v9L12 21l-8-4.5v-9L12 3z" /><path d="M4 7.5l8 4.5 8-4.5M12 12v9" /></svg></button>
            <button className="profile-trigger launcher-profile-trigger" onClick={() => setShowProfile(true)} title="Открыть профиль">
              <span className="profile-avatar-letter">{(config.nickname || 'G').slice(0, 1).toUpperCase()}</span>
              <span className="profile-trigger-text">{config.nickname}</span>
              <span className="profile-chevron">⌄</span>
            </button>
            <div className="top-version">v1.4.5</div>
          </div>
        </header>

        <div className="app-body">
          <aside className="launcher-sidebar">
            <div className="sidebar-section-title">РАЗДЕЛЫ</div>
            <nav className="sidebar-nav" aria-label="Главная навигация">
              {navItems.map((item) => (
                <button
                  key={item.key}
                  className={`sidebar-nav-btn ${page === item.key ? 'active' : ''}`}
                  onClick={() => setPage(item.key)}
                  title={item.label}
                >
                  <span className="sidebar-nav-icon">
                    {item.icon === 'together' ? (
                      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="9" cy="8" r="3.2" /><path d="M3 20c.6-3.4 3-5 6-5s5.4 1.6 6 5" /><circle cx="17" cy="9" r="2.4" /><path d="M16.5 14.2c2.4.2 4 1.6 4.5 4.3" /></svg>
                    ) : item.icon === 'stats' ? (
                      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M4 20V10M10 20V4M16 20v-7M22 20H2" /></svg>
                    ) : (navIcons[item.icon] || (item.icon === 'worlds' ? navIcons.server : undefined)) ? (
                      <img src={navIcons[item.icon] || navIcons.server} alt="" />
                    ) : (
                      <span>{item.label[0]}</span>
                    )}
                  </span>
                  <span className="sidebar-nav-label">{item.label}</span>
                  <span className="sidebar-nav-active-mark" />
                </button>
              ))}
            </nav>

            <div className="sidebar-spacer" />

            <button className="sidebar-ai-card" onClick={() => openAI()}>
              <span className="sidebar-ai-symbol">AI</span>
              <span className="sidebar-ai-copy"><strong>GROM AI</strong><small>Помощник лаунчера</small></span>
              <span className="sidebar-ai-arrow">↗</span>
            </button>

            <button className="sidebar-account" onClick={() => setShowProfile(true)}>
              <span className="sidebar-account-avatar">{(config.nickname || 'G').slice(0, 1).toUpperCase()}</span>
              <span className="sidebar-account-copy"><strong>{config.nickname || 'Игрок'}</strong><small>{config.accountType === 'microsoft' ? 'Microsoft · Minecraft' : 'Локальный аккаунт'}</small></span>
              <span className="sidebar-account-more">•••</span>
            </button>
            <div className="sidebar-footnote"><span /> GROM CLIENT <span className="sidebar-footnote-version">v1.4.5</span></div>
          </aside>

          <main className={`content launcher-content ${page === 'messenger' ? 'launcher-content-messenger' : ''}`} key={animKey}>
            {page === 'home' && <HomePage config={config} updateConfig={updateConfig} instances={instances} activeInstance={activeInstance} setActiveInstance={setActiveInstance} refreshInstances={refreshInstances} openModal={setModal} backgroundUrl={backgroundUrl} />}
            {page === 'news' && <NewsPage />}
            {page === 'together' && <PlayTogether config={config} instances={instances} activeInstance={activeInstance} refreshInstances={refreshInstances} />}
            {page === 'stats' && <Stats nickname={config.nickname} />}
            {page === 'addons' && <AddonsPage config={config} activeInstance={activeInstance} refreshInstances={refreshInstances} openModal={setModal} />}
            {page === 'modpacks' && <ModpacksPage config={config} instances={instances} refreshInstances={refreshInstances} openModal={setModal} />}
            {page === 'worlds' && <WorldsPage config={config} activeInstance={activeInstance} openModal={setModal} />}
            {page === 'messenger' && (
              <Messenger
                nickname={config.nickname}
                initialChat={pendingChatNickname}
                onInitialChatHandled={() => setPendingChatNickname(null)}
                onCall={(target, avatar) => { if (CALLS_ENABLED && !call) setCall({ peer: { nickname: target, avatar }, role: 'caller', room: newRoomId() }); }}
                onOpenProfile={(nick) => setProfileTarget(nick)}
              />
            )}
            {page === 'ai' && <TerminalPage onBack={() => { setPage('home'); setAiInitialQuestion(''); }} initialQuestion={aiInitialQuestion} />}
            {page === 'skins' && <SkinStudio accountType={config.accountType || 'offline'} />}
            {page === 'settings' && (
              <SettingsPage config={config} updateConfig={updateConfig} fontData={fontData} setFontData={setFontData} setBackgroundUrl={setBackgroundUrl} />
            )}
            {page === 'about' && <AboutPage config={config} />}
          </main>
        </div>
      </div>

      {CALLS_ENABLED && call && (
        <CallModal key={call.room} nickname={config.nickname} peer={call.peer} role={call.role} room={call.room} onClose={() => setCall(null)} />
      )}

      {CALLS_ENABLED && incoming && !call && (
        <div className="incoming-call" role="alertdialog" aria-label="Входящий звонок">
          <div className="call-avatar small">{incoming.avatar ? <img src={incoming.avatar} alt="" /> : incoming.from[0]?.toUpperCase()}</div>
          <div className="incoming-copy"><strong>{incoming.from}</strong><small>Входящий звонок</small></div>
          <button className="small-button call-hangup" onClick={() => { sendToInbox(incoming.from, 'decline', { room: incoming.room }).catch(() => {}); setIncoming(null); }}>Отклонить</button>
          <button className="small-button primary" onClick={() => { setCall({ peer: { nickname: incoming.from, avatar: incoming.avatar }, role: 'callee', room: incoming.room }); setIncoming(null); }}>Принять</button>
        </div>
      )}

      {showProfile && (
        <ProfileModal
          nickname={config.nickname}
          accountType={config.accountType}
          onClose={() => setShowProfile(false)}
          onNicknameChange={(n) => updateConfig('nickname', n)}
          onAccountChange={(n, accountType) => {
            setConfigState((prev) => prev ? { ...prev, nickname: n, accountType } : prev);
            void window.grom.setConfig('nickname', n);
            void window.grom.setConfig('accountType', accountType);
          }}
        />
      )}

      {profileTarget && (
        <ProfileModal
          nickname={config.nickname}
          accountType={config.accountType}
          targetNickname={profileTarget}
          onClose={() => setProfileTarget(null)}
          onStartChat={(nick) => {
            setPendingChatNickname(nick);
            setProfileTarget(null);
            setPage('messenger');
          }}
        />
      )}

      {modal && (
        <Modal
          title={modal.title}
          fields={modal.fields}
          confirmText={modal.confirmText}
          onConfirm={(values) => { modal.onConfirm(values); setModal(null); }}
          onCancel={() => setModal(null)}
        />
      )}

      <ReleaseGate />
      <ToastContainer />
    </div>
  );
}

function injectFont(font: FontItem) {
  const existing = document.getElementById('grom-custom-font');
  if (existing) existing.remove();
  const style = document.createElement('style');
  style.id = 'grom-custom-font';
  style.textContent = `
    @font-face { font-family: '${font.name}'; src: url(${font.dataUrl}); }
    body, button, input, select, textarea { font-family: '${font.name}', 'Segoe UI', sans-serif !important; }
  `;
  document.head.appendChild(style);
}

interface PageProps { config: GromConfig; updateConfig: (key: keyof GromConfig, value: any) => void; }

function HomePage({ config, updateConfig, instances, activeInstance, setActiveInstance, refreshInstances, openModal, backgroundUrl }: PageProps & { instances: Instance[]; activeInstance: string; setActiveInstance: (v: string) => void; refreshInstances: () => void; openModal: ModalOpener; backgroundUrl: string }) {
  const [skinPreview, setSkinPreview] = useState<string | null>(null);
  const [showImport, setShowImport] = useState(false);
  const [capePreview, setCapePreview] = useState<string | null>(null);
  const [versions, setVersions] = useState<string[]>([]);
  const [versionsLoading, setVersionsLoading] = useState(true);
  const [versionsLoadError, setVersionsLoadError] = useState(false);
  const [versionsRetryKey, setVersionsRetryKey] = useState(0);
  const [versionSearch, setVersionSearch] = useState('');
  const [showVersionList, setShowVersionList] = useState(false);
  const [javaInfo, setJavaInfo] = useState<JavaInfo | null>(null);
  const [requiredJavaVersion, setRequiredJavaVersion] = useState<number>(0);
  const [javaResolvedForVersion, setJavaResolvedForVersion] = useState<string | null>(null);
  const [javaChecking, setJavaChecking] = useState(true);
  const javaRequestRef = useRef(0);
  const javaCompatible = javaResolvedForVersion === config.version && !!javaInfo?.found && javaInfo.majorVersion === requiredJavaVersion;
  const [launching, setLaunching] = useState(false);
  const [statusMessage, setStatusMessage] = useState('');
  const [progress, setProgress] = useState(0);
  const [showProgress, setShowProgress] = useState(false);
  const [progressOperation, setProgressOperation] = useState<'launch' | 'java' | 'loader'>('launch');
  const [showNewInstance, setShowNewInstance] = useState(false);
  const [newInstanceName, setNewInstanceName] = useState('');
  const [showPresets, setShowPresets] = useState(false);
  const [aiLoading, setAiLoading] = useState(false);

  useEffect(() => {
    (async () => {
      const skin = await window.grom.loadSavedFile('skin');
      const cape = await window.grom.loadSavedFile('cape');
      if (skin) setSkinPreview(skin);
      if (cape) setCapePreview(cape);
    })();

    const unsub = window.grom.onGameStatus((data) => {
      setStatusMessage(data.message);
      if (data.progress !== undefined) setProgress(data.progress);
      if (data.stage === 'installing') setShowProgress(true);
      if (data.stage === 'running') { setLaunching(true); setTimeout(() => setShowProgress(false), 2000); }
      if (data.stage === 'stopped') { setLaunching(false); setStatusMessage(''); setProgress(0); setShowProgress(false); }
    });
    return unsub;
  }, []);

  useEffect(() => {
    let active = true;
    setVersionsLoading(true);
    setVersionsLoadError(false);
    window.grom.getVersions()
      .then((vers) => {
        if (!active) return;
        const clean = Array.isArray(vers) ? Array.from(new Set(vers.filter((v) => typeof v === 'string' && v.trim()))) : [];
        setVersions(clean);
        if (!config.version && clean.length > 0) updateConfig('version', clean[0]);
        if (!clean.length) setVersionsLoadError(true);
      })
      .catch(() => { if (active) setVersionsLoadError(true); })
      .finally(() => { if (active) setVersionsLoading(false); });
    return () => { active = false; };
  }, [versionsRetryKey]);

  useEffect(() => {
    const selectedVersion = config.version;
    setJavaChecking(true);
    setJavaInfo(null);
    setJavaResolvedForVersion(null);
    setRequiredJavaVersion(0);
    // Do not leave a progress panel showing a download from the previously selected Java runtime.
    setShowProgress(false);
    setStatusMessage('');
    setProgress(0);
    const requestId = ++javaRequestRef.current;
    let active = true;
    let downloadTimer: number | undefined;

    if (!selectedVersion) {
      setJavaInfo({ found: false, path: null, version: null, majorVersion: null });
      setRequiredJavaVersion(0);
      setJavaResolvedForVersion('');
      setJavaChecking(false);
      return () => { active = false; };
    }

    (async () => {
      try {
        const required = await window.grom.getRequiredJava(selectedVersion);
        if (!active || javaRequestRef.current !== requestId) return;
        setRequiredJavaVersion(required);

        const java = await window.grom.findJava(required);
        if (!active || javaRequestRef.current !== requestId) return;
        setJavaInfo(java);
        setJavaResolvedForVersion(selectedVersion);
        setJavaChecking(false);

        if (java.found && java.majorVersion === required) {
          setStatusMessage('');
          setShowProgress(false);
          return;
        }

        // Let quick version-list clicks settle, then fetch that version's exact runtime in the background.
        downloadTimer = window.setTimeout(() => {
          if (!active || javaRequestRef.current !== requestId) return;
          setProgressOperation('java');
          setStatusMessage(`Скачивание Java ${required} для Minecraft ${selectedVersion}...`);
          setShowProgress(true);
          setProgress(0);

          void window.grom.downloadJava(selectedVersion).then(async (result) => {
            if (!active || javaRequestRef.current !== requestId) return;
            if (!result.success) {
              setStatusMessage('');
              setShowProgress(false);
              toast(`Не удалось установить Java ${required}: ${result.error || 'неизвестная ошибка'}`);
              return;
            }
            const installed = await window.grom.findJava(required);
            if (!active || javaRequestRef.current !== requestId) return;
            setJavaInfo(installed);
            setStatusMessage(`Java ${required} установлена для Minecraft ${selectedVersion}`);
            setProgress(100);
            toast(`Java ${required} готова для ${selectedVersion}`);
            window.setTimeout(() => {
              if (active && javaRequestRef.current === requestId) {
                setShowProgress(false);
                setStatusMessage('');
              }
            }, 1600);
          }).catch((error: any) => {
            if (!active || javaRequestRef.current !== requestId) return;
            setStatusMessage('');
            setShowProgress(false);
            toast(`Не удалось установить Java ${required}: ${error?.message || error}`);
          });
        }, 650);
      } catch {
        if (active && javaRequestRef.current === requestId) {
          const id = String(selectedVersion || '');
          const legacy = id.match(/^1\.(\d+)/);
          const fallbackJava = /^a\d|^b\d|^rd-|^inf-|^c0\./i.test(id) ? 8
            : /^26\./.test(id) ? 25
            : legacy ? (Number(legacy[1]) >= 21 ? 21 : Number(legacy[1]) >= 18 ? 17 : Number(legacy[1]) === 17 ? 16 : 8)
            : /^\d{2}w/.test(id) ? (Number(id.slice(0, 2)) >= 26 ? 25 : 21) : 8;
          setRequiredJavaVersion(fallbackJava);
          setJavaInfo({ found: false, path: null, version: null, majorVersion: null });
          setJavaResolvedForVersion(selectedVersion);
          setJavaChecking(false);
        }
      }
    })();

    return () => {
      active = false;
      if (downloadTimer !== undefined) window.clearTimeout(downloadTimer);
    };
  }, [config.version]);

  const handlePickSkin = async () => {
    const r = await window.grom.pickFile('skin');
    if (!r) return;
    setSkinPreview(r);
    if (config.accountType === 'microsoft') {
      const applied = await window.grom.applyMinecraftSkin('classic');
      if (applied.success) toast('Скин сохранён и применён к Microsoft-профилю Minecraft. Перезапусти игру, если она уже открыта.');
      else toast(`Скин сохранён локально, но не применён: ${applied.error || 'ошибка Minecraft Services'}`);
    } else {
      const cloud = typeof r === 'string' ? await publishSkin(r) : { ok: false, error: '' };
      toast(cloud.ok ? 'Скин сохранён — другие игроки Grom увидят его в игре.' : `Скин сохранён локально. ${cloud.error || ''}`.trim());
    }
  };
  const handlePickCape = async () => { const r = await window.grom.pickFile('cape'); if (r) setCapePreview(r); };


  const handleInstallJava = async () => {
    const installingForVersion = config.version;
    const requiredForVersion = requiredJavaVersion;
    setJavaChecking(true);
    setJavaResolvedForVersion(null);
    setProgressOperation('java');
    setStatusMessage(`Скачивание Java ${requiredForVersion} для ${installingForVersion}…`);
    setShowProgress(true);
    setProgress(0);
    try {
      const result = await window.grom.downloadJava(installingForVersion || '1.21');
      if (!result.success) throw new Error(result.error || 'Не удалось установить Java.');
      const java = await window.grom.findJava(requiredForVersion);
      setJavaInfo(java);
      setJavaResolvedForVersion(installingForVersion);
      setJavaChecking(false);
      setStatusMessage(java.found && java.majorVersion === requiredForVersion ? 'Java установлена и проверена.' : `Runtime установлен, но не удалось подтвердить Java ${requiredForVersion}.`);
      setProgress(100);
      if (java.found && java.majorVersion === requiredForVersion) toast(`Java ${requiredForVersion} готова для ${installingForVersion}`);
      else toast(`Не удалось подтвердить Java ${requiredForVersion}. Проверь папку runtime.`);
      window.setTimeout(() => setShowProgress(false), 1800);
    } catch (error: any) {
      setJavaResolvedForVersion(installingForVersion);
      setJavaInfo({ found: false, path: null, version: null, majorVersion: null });
      setJavaChecking(false);
      toast('Ошибка установки Java: ' + (error?.message || error));
      setStatusMessage('');
      setShowProgress(false);
    }
  };

  const handleInstallLoader = async () => {
    if (!config.version) { toast('Сначала выбери версию'); return; }
    setProgressOperation('loader');
    setStatusMessage(`Установка ${config.loader}...`);
    setShowProgress(true);
    setProgress(0);
    const res = await window.grom.installLoader(config.loader, config.version);
    if (res.success) {
      setStatusMessage(`${config.loader} установлен`);
      setProgress(100);
      setShowProgress(true);
      toast(`${config.loader} установлен! Теперь жми «Играть»`);
      window.setTimeout(() => setShowProgress(false), 1500);
    } else {
      toast('Ошибка: ' + res.error);
      setStatusMessage('');
      setShowProgress(false);
    }
  };

  const handleCreateInstance = async () => {
    if (!newInstanceName.trim()) return;
    const result = await window.grom.createInstance(newInstanceName.trim(), config.version, config.loader);
    if (result.success) {
      await refreshInstances();
      setActiveInstance(newInstanceName.trim());
      setNewInstanceName('');
      setShowNewInstance(false);
      toast('Сборка создана!');
    } else {
      toast('Ошибка: ' + result.error);
    }
  };

  const handleApplyPreset = async (preset: ModPreset) => {
    if (!activeInstance) { toast('Сначала выбери сборку'); return; }
    let installed = 0;
    for (const mod of preset.mods) {
      try {
        const loaderForApi = config.loader === 'Vanilla' ? '' : config.loader.toLowerCase();
        const res = await window.grom.searchMods(mod.slug, config.version, loaderForApi, 'mod');
        if (Array.isArray(res) && res.length > 0) {
          const downloadRes = await window.grom.downloadMod(res[0].id, config.version, loaderForApi, activeInstance);
          if (downloadRes.success) installed++;
        }
      } catch {}
    }
    await refreshInstances();
    setShowPresets(false);
    toast(`Установлено ${installed} из ${preset.mods.length} модов`);
  };

  const handleAiGenerate = () => {
    if (!activeInstance) { toast('Сначала выбери сборку'); return; }
    openModal({
      title: 'ИИ-сборка',
      fields: [
        { key: 'apiKey', label: 'DeepSeek API-ключ', placeholder: 'sk-...' },
        { key: 'prompt', label: 'Опиши сборку', placeholder: 'PvP сборка для 1.21.4' },
      ],
      confirmText: 'Сгенерировать',
      onConfirm: async (values) => {
        if (!values.apiKey || !values.prompt) return;
        setAiLoading(true);
        try {
          const res = await window.grom.generateModpack(values.apiKey, values.prompt);
          if (!res.success || !res.pack) { toast('Ошибка ИИ'); return; }
          let count = 0;
          for (const slug of res.pack.mods) {
            try {
              const loaderForApi = config.loader === 'Vanilla' ? '' : config.loader.toLowerCase();
              const searchRes = await window.grom.searchMods(slug, config.version, loaderForApi, 'mod');
              if (Array.isArray(searchRes) && searchRes.length > 0) {
                await window.grom.downloadMod(searchRes[0].id, config.version, loaderForApi, activeInstance);
                count++;
              }
            } catch {}
          }
          await refreshInstances();
          toast(`Установлено ${count} модов`);
        } finally { setAiLoading(false); }
      },
    });
  };


  const handlePlay = async () => {
    setProgressOperation('launch');
    if (!config.nickname.trim()) { toast('Введи ник'); return; }
    if (!config.version) { toast('Выбери версию'); return; }
    setLaunching(true);
    setStatusMessage('Подготовка...');
    setShowProgress(true);
    setProgress(0);
    try {
      const result = await window.grom.launch({
        nickname: config.nickname,
        version: config.version,
        loader: config.loader,
        ram: config.ram,
        width: config.width,
        height: config.height,
        fullscreen: config.fullscreen,
        instance: activeInstance || undefined,
      });
      if (!result.success) {
        toast(result.error || 'Ошибка запуска');
        setLaunching(false); setStatusMessage(''); setShowProgress(false);
      }
    } catch (err: any) {
      toast(err.message || 'Ошибка');
      setLaunching(false); setStatusMessage(''); setShowProgress(false);
    }
  };

  const filteredVersions = versions.filter((v) => v.toLowerCase().includes(versionSearch.toLowerCase()));
  const heroImage = backgroundUrl || heroBackground;

  return (
    <div className="home-page home-page-redesigned">
      <div className="home-heading-row">
        <div>
          <h1>Главная</h1>
        </div>
      </div>

      <section className="launcher-hero" style={{ backgroundImage: `linear-gradient(90deg, rgba(8, 11, 15, .94) 0%, rgba(8, 11, 15, .77) 43%, rgba(8, 11, 15, .12) 100%), linear-gradient(0deg, rgba(8, 11, 15, .38), transparent 55%), url("${heroImage}")` }}>
        <div className="launcher-hero-topline">
          <span className="launcher-game-pill"><span /> Java Edition</span>
          <span className="launcher-hero-version">{config.version || 'Версия не выбрана'}</span>
        </div>
        <div className="launcher-hero-copy">
          <h2 className="launcher-hero-title">Minecraft</h2>
        </div>
      </section>

      <div className="home-workspace">
        <section className="launch-config-card">
          <div className="section-card-heading">
            <div><h2>Настройки запуска</h2></div>
            <span className={`java-compact-status ${!config.version || javaChecking || javaResolvedForVersion !== config.version ? 'is-loading' : javaCompatible ? 'is-ok' : 'is-error'}`}>
              <span />{!config.version ? 'Выбери версию'
                : javaChecking || javaResolvedForVersion !== config.version
                  ? `Определяем Java для ${config.version}…`
                  : javaCompatible ? `Java ${javaInfo?.majorVersion || requiredJavaVersion}` : `Нужна Java ${requiredJavaVersion}`}
            </span>
          </div>

          <div className="launch-config-grid">
            <div className="launch-field launch-version-field">
              <label htmlFor="grom-version-search">Версия Minecraft</label>
              <div className="version-select-wrapper launcher-version-select">
                <input
                  id="grom-version-search"
                  type="text"
                  value={showVersionList ? versionSearch : config.version}
                  onChange={(e) => { setVersionSearch(e.target.value); setShowVersionList(true); }}
                  onFocus={() => { setShowVersionList(true); setVersionSearch(''); }}
                  onBlur={() => window.setTimeout(() => setShowVersionList(false), 180)}
                  autoComplete="off"
                  placeholder="Поиск версии..."
                  aria-label="Поиск версии Minecraft"
                />
                <span className="field-trailing-icon">⌕</span>
                {showVersionList && (
                  <div className="version-list launcher-version-list">
                    <div className="version-list-heading"><span>ДОСТУПНЫЕ ВЕРСИИ</span><span>{versionsLoading ? '…' : filteredVersions.length}</span></div>
                    {versionsLoading && <div className="version-item disabled">Загрузка списка версий Minecraft…</div>}
                    {!versionsLoading && versionsLoadError && <button type="button" className="version-item disabled" onMouseDown={(e) => e.preventDefault()} onClick={() => setVersionsRetryKey((n) => n + 1)}>Не удалось загрузить список. Нажми, чтобы повторить</button>}
                    {!versionsLoading && !versionsLoadError && filteredVersions.length === 0 && <div className="version-item disabled">Совпадений пока нет</div>}
                    {!versionsLoading && filteredVersions.slice(0, 40).map((v) => (
                      <button type="button" key={v} className={`version-item ${v === config.version ? 'selected' : ''}`} onMouseDown={(e) => e.preventDefault()} onClick={() => { updateConfig('version', v); setVersionSearch(''); setShowVersionList(false); }}>
                        <span className="version-item-status" />
                        <span>{v}</span>
                        {v === config.version && <span className="version-item-check">✓</span>}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <span className="launch-field-hint">Поиск по номеру версии</span>
            </div>

            <div className="launch-field launch-loader-field">
              <label>Загрузчик</label>
              <div className="loader-segment-control" role="group" aria-label="Выбор загрузчика">
                <button type="button" className={config.loader === 'Vanilla' ? 'active' : ''} onClick={() => updateConfig('loader', 'Vanilla')}>
                  <span className="loader-option-mark vanilla-mark">V</span><span>Vanilla</span>
                </button>
                <button type="button" className={config.loader === 'Fabric' ? 'active' : ''} onClick={() => updateConfig('loader', 'Fabric')}>
                  <span className="loader-option-mark fabric-mark">F</span><span>Fabric</span>
                </button>
              </div>
              <div className="loader-field-footer">
                <span className="launch-field-hint">{config.loader === 'Fabric' ? 'Для модов и оптимизации' : 'Оригинальная игра'}</span>
                {config.loader === 'Fabric' && (
                  <button className="install-loader-link" onClick={handleInstallLoader} disabled={!config.version || showProgress}>
                    <span>↓</span> Установить Fabric
                  </button>
                )}
              </div>
            </div>

            <div className="launch-field launch-nickname-field">
              <label htmlFor="grom-player-name">Имя игрока</label>
              <div className="nickname-input-wrap"><span className="nickname-input-mark">♙</span><input id="grom-player-name" type="text" value={config.nickname} onChange={(e) => updateConfig('nickname', e.target.value)} maxLength={16} placeholder="Твой ник" /></div>
              <span className="launch-field-hint">{config.accountType === 'microsoft' ? 'Профиль Minecraft' : 'Локальный профиль · офлайн-сессия'}</span>
            </div>
          </div>

          <div className="instance-selector launcher-instance-selector">
            <div className="instance-selector-label"><span className="instance-selector-glyph">▦</span><label htmlFor="grom-instance-select">Сборка</label></div>
            <select id="grom-instance-select" value={activeInstance} onChange={(e) => setActiveInstance(e.target.value)}>
              <option value="">Обычный профиль игры</option>
              {instances.map((inst) => <option key={inst.name} value={inst.name}>{inst.name} — {inst.version} ({inst.modsCount} модов)</option>)}
            </select>
            <button className="instance-action-button" onClick={() => setShowNewInstance(!showNewInstance)} title="Создать сборку">＋ <span>Создать</span></button>
            <button className="instance-action-button" onClick={() => setShowPresets(!showPresets)} title="Пресеты сборок">☷ <span>Пресеты</span></button>
            <button className="instance-action-button" onClick={handleAiGenerate} disabled={aiLoading} title="Создать сборку с ИИ">✦ <span>ИИ</span></button>
          </div>

          {showNewInstance && (
            <div className="new-instance-form launcher-inline-form">
              <input type="text" value={newInstanceName} onChange={(e) => setNewInstanceName(e.target.value)} placeholder="Название новой сборки" />
              <button className="small-button" onClick={handleCreateInstance}>Создать сборку</button>
            </div>
          )}

          {showPresets && (
            <div className="presets-panel launcher-presets-panel">
              <h3>Пресеты сборок</h3>
              <div className="presets-grid">
                {MOD_PRESETS.map((preset) => (
                  <div key={preset.id} className="preset-card" onClick={() => handleApplyPreset(preset)}>
                    <div className="preset-icon">{preset.name[0]}</div><h4>{preset.name}</h4><p>{preset.description}</p><span className="hint">{preset.mods.length} модов</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="launch-action-footer">
            <div className="launch-ready-copy"><span className="launch-ready-dot" /><div><strong>{launching ? 'Игра запускается' : 'Готово к запуску'}</strong><small>{config.version || 'Выбери версию'} · {config.loader} · {Math.round(config.ram / 1024)} ГБ RAM</small></div></div>
            <button className="play-button-image launcher-play-button" onClick={handlePlay} disabled={launching || !config.version}>
              <span className="play-button-icon">▶</span><span>{launching ? 'ЗАПУСК...' : 'ИГРАТЬ'}</span>
            </button>
          </div>
        </section>

        <aside className="home-utility-column">
          <section className="home-utility-card home-customization-card">
            <div className="utility-card-heading"><span className="utility-card-icon">✳</span><div><h3>Скин и плащ</h3></div></div>
            <div className="customization-preview-row">
              <div className="customization-preview"><div className="customization-thumb skin-thumb">{skinPreview ? <img src={skinPreview} alt="Скин" /> : <span>SKIN</span>}</div><div><strong>Скин</strong><small>{skinPreview ? 'Загружен' : 'Не выбран'}</small></div><button onClick={handlePickSkin} title="Загрузить скин">＋</button></div>
              <div className="customization-preview"><div className="customization-thumb cape-thumb">{capePreview ? <img src={capePreview} alt="Плащ" /> : <span>CAPE</span>}</div><div><strong>Плащ</strong><small>{capePreview ? 'Загружен' : 'Не выбран'}</small></div><button onClick={handlePickCape} title="Загрузить плащ">＋</button></div>
            </div>
            <details className="launcher-more-details">
              <summary>3D-просмотр</summary>
              <div className="skin-3d-section launcher-skin-3d-section"><SkinViewer skinUrl={skinPreview} capeUrl={capePreview} width={220} height={220} /></div>
            </details>
          </section>

          {!javaChecking && javaResolvedForVersion === config.version && requiredJavaVersion > 0 && !javaCompatible && (
            <button className="java-install-card" onClick={handleInstallJava} disabled={showProgress}>
              <span className="java-install-icon">↓</span><span><strong>Установить Java {requiredJavaVersion}</strong><small>Версия для выбранного Minecraft</small></span><span className="java-install-arrow">→</span>
            </button>
          )}
          <button className="home-utility-card import-card" onClick={() => setShowImport(true)}>
            <span className="utility-card-icon">⇄</span>
            <span><strong>Перенести из другого лаунчера</strong><small>Настройки, ресурспаки, миры, скины</small></span>
          </button>
        </aside>
        {showImport && <ImportModal instances={instances} activeInstance={activeInstance} onClose={() => setShowImport(false)} />}
      </div>
      {showProgress && (
        <LaunchExperience
          progress={progress}
          message={statusMessage}
          version={config.version || 'Не выбрана'}
          loader={config.loader || 'Vanilla'}
          nickname={config.nickname || 'Игрок'}
          operation={progressOperation}
          appIcon={config.appIcon}
          theme={config.theme}
        />
      )}
    </div>
  );
}

function NewsPage() {
  const [tab, setTab] = useState<'minecraft' | 'launcher'>('minecraft');
  const [items, setItems] = useState<MinecraftNewsItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [cached, setCached] = useState(false);

  const loadMinecraftNews = async () => {
    setLoading(true);
    setError('');
    try {
      const result = await window.grom.getMinecraftNews();
      if (result.success && result.items.length) {
        setItems(result.items);
        setCached(Boolean(result.cached || result.stale));
      } else {
        setError(result.error || 'Не удалось загрузить новости Minecraft.');
      }
    } catch (e: any) {
      setError(e?.message || 'Не удалось загрузить новости Minecraft.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void loadMinecraftNews(); }, []);

  const launcherReleases = [
    { version: '1.4.4', date: '21.10.2026', title: 'Исправлена проверка DLL для Minecraft 26.3', changes: ['Исправлено имя native DLL Shaderc: загрузчик проверяет shaderc.dll, которое фактически распаковывается из lwjgl-shaderc 3.4.3.', 'Сохранена проверка обязательных SDL3.dll и spirv-cross.dll; ошибка о shaderc_shared.dll больше не блокирует запуск при наличии shaderc.dll.'] },
    { version: '1.4.3', date: '21.10.2026', title: 'Нативные библиотеки Minecraft 26.3', changes: ['Добавлена загрузка Windows-native для LWJGL SDL, Shaderc, SPVC и SPNG, используемых современными версиями.', 'Перед запуском проверяются SDL3.dll и spirv-cross.dll, чтобы обнаруживать неполный набор библиотек до падения игры.', 'lwjgl-vulkan остаётся без автоматически выдуманного native-архива.'] },
    { version: '1.4.2', date: '21.10.2026', title: 'Восстановлены нативные библиотеки Minecraft', changes: ['Восстановлен резервный выбор Windows-native для известных модулей LWJGL в версиях, где метаданные не перечисляют Windows-классификатор.', 'Для lwjgl-vulkan не создаётся несуществующий Windows-native JAR — подготовка 26.3 не должна падать из-за HTTP 404.', 'Офлайн-профиль получает стабильный UUID OfflinePlayer вместо нулевого UUID.'] },
    { version: '1.4.1', date: '21.10.2026', title: 'Исправлена подготовка Minecraft 26.3 и вход в профиль', changes: ['Больше не создаётся несуществующий lwjgl-vulkan-*-natives-windows.jar: нативный классификатор берётся из метаданных версии.', 'Офлайн-профиль Grom явно отделён от официальной сессии Minecraft.', 'В окне профиля добавлен прямой переход к официальному входу Microsoft.'] },
    { version: '1.4.0', date: '21.10.2026', title: 'Исправлена загрузка нативных библиотек', changes: ['Исправлена обработка повторяющихся записей библиотек, из-за которых пропускались native JAR.', 'Добавлено восстановление явно объявленных Windows-классификаторов LWJGL при неполной карте загрузок.', 'Перед запуском проверяется наличие lwjgl.dll; подробный лог показывает распакованные нативные файлы.'] },
    { version: '1.3.9', date: '21.10.2026', title: 'Исправлен запуск старых версий', changes: ['Исправлена обработка аргументов Alpha/Beta и выбор AlphaVanillaTweaker.', 'Добавлена подстановка пути game_assets для старых версий.', 'В лог запуска добавлен список файлов classpath.'] },
    { version: '1.3.8', date: '21.10.2026', title: 'Обновление главной страницы', changes: ['Убрана вкладка «Визуалы».', 'Удалена загрузка скинов с Ely.by с главной страницы.', 'Убраны рекламные фразы и упрощено оформление лаунчера.', 'Убраны декоративные облака поверх интерфейса.'] },
    { version: '1.3.7', date: '20.10.2026', title: 'Новости Minecraft и история обновлений', changes: ['Добавлена отдельная вкладка официальных новостей Minecraft с датами публикаций.', 'Добавлена история версий Grom Client с описанием изменений.', 'Добавлены состояния загрузки, повторная загрузка и кеш новостей.'] },
    { version: '1.3.6', date: '20.10.2026', title: 'Исправления версий, Java, чата и скинов', changes: ['Исправлено состояние загрузки списка версий Minecraft.', 'Улучшен сброс и обновление сведений о Java при смене версии.', 'Добавлены повторная синхронизация сообщений и попытка применить скин через Microsoft.'] },
    { version: '1.3.5', date: '20.10.2026', title: 'Java, natives и стабильность запуска', changes: ['Обновлён подбор Java для разных поколений Minecraft.', 'Исправлена подготовка classpath и нативных библиотек.', 'Исправлено выравнивание иконки в окне «О программе».'] },
    { version: '1.3.4', date: '20.10.2026', title: 'Java 25 и иконка лаунчера', changes: ['Добавлена поддержка выбора Java 25 для Minecraft 26.3.', 'Иконка приложения используется в дополнительных элементах интерфейса.', 'Улучшена проверка установленного runtime.'] },
    { version: '1.3.3', date: '20.10.2026', title: 'Компактный интерфейс и мессенджер', changes: ['Упрощены профиль и экран входа.', 'Исправлена прокрутка страницы при просмотре сообщений.', 'Переход из профиля игрока открывает выбранный диалог.'] },
    { version: '1.3.2', date: '20.10.2026', title: 'Проверка файлов и обновление интерфейса', changes: ['Добавлены проверки основных игровых файлов.', 'Обновлены профиль и экран входа.', 'Добавлена диагностика ошибок запуска.'] },
    { version: '1.3.1', date: '20.10.2026', title: 'Инструменты обслуживания', changes: ['Добавлены первые инструменты диагностики и проверки модов.', 'Добавлен импорт локальных модов перетаскиванием в папку mods.'] },
  ];

  const formatNewsDate = (value: string) => {
    if (!value) return 'Дата не указана';
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? value : new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: 'long', year: 'numeric' }).format(parsed);
  };

  return <section className="news-page">
    <div className="news-heading"><div><h1>Новости</h1><p>Последние новости Minecraft и обновления Grom Client</p></div></div>
    <div className="news-tabs" role="tablist" aria-label="Раздел новостей">
      <button className={tab === 'minecraft' ? 'active' : ''} role="tab" aria-selected={tab === 'minecraft'} onClick={() => setTab('minecraft')}><span className="news-tab-dot minecraft-dot" />Новости Minecraft</button>
      <button className={tab === 'launcher' ? 'active' : ''} role="tab" aria-selected={tab === 'launcher'} onClick={() => setTab('launcher')}><span className="news-tab-dot grom-dot" />Новости лаунчера</button>
    </div>

    {tab === 'minecraft' && <div className="news-feed">
      {loading && items.length === 0 && <div className="news-state"><span className="news-spinner" /><strong>Загружаем новости Minecraft…</strong><small>Получаем публикации из официальной ленты</small></div>}
      {error && items.length === 0 && <div className="news-state"><strong>Не удалось загрузить новости</strong><small>{error}</small><button className="news-retry" onClick={() => void loadMinecraftNews()}>Повторить</button></div>}
      {cached && <div className="news-cache-note">Показаны сохранённые новости — сейчас нет свежего ответа от сервера.</div>}
      {items.map((item) => <article className="news-card news-minecraft-card" key={item.id}>
        {item.image && <div className="news-image-wrap"><img src={item.image} alt="" loading="lazy" onError={(e) => { e.currentTarget.style.display = 'none'; }} /></div>}
        <div className="news-card-content"><div className="news-card-meta"><span className="news-date">{formatNewsDate(item.date)}</span><span className="news-category">{item.category}</span></div><h3>{item.title}</h3>{item.text && <p>{item.text}</p>}{item.url && <button className="news-read-more" onClick={() => void window.grom.openExternal(item.url)}>Читать на Minecraft.net <span>↗</span></button>}</div>
      </article>)}
      {!loading && items.length > 0 && <button className="news-retry news-refresh" onClick={() => void loadMinecraftNews()} disabled={loading}>Обновить новости</button>}
    </div>}

    {tab === 'launcher' && <div className="news-list launcher-release-list">
      {launcherReleases.map((release) => <article className="news-card launcher-release-card" key={release.version}>
        <div className="release-topline"><span className="release-version">Grom Client {release.version}</span><span className="news-date">{release.date}</span></div>
        <h3>{release.title}</h3><ul>{release.changes.map((change, index) => <li key={index}>{change}</li>)}</ul>
      </article>)}
    </div>}
  </section>;
}


// ═══════════════════════════════════════════════════════
// ADDONS PAGE (Моды / Ресурспаки / Шейдеры)
// ═══════════════════════════════════════════════════════
function AddonsPage({ config, activeInstance, refreshInstances, openModal }: { config: GromConfig; activeInstance: string; refreshInstances: () => void; openModal: ModalOpener }) {
  const [tab, setTab] = useState<AddonTab>('mod');
  const [search, setSearch] = useState('');
  const [results, setResults] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [isPopular, setIsPopular] = useState(true);
  const [dragOver, setDragOver] = useState(false);
  const [localModMessage, setLocalModMessage] = useState('');
  const [importingLocalMod, setImportingLocalMod] = useState(false);

  useEffect(() => {
    (async () => {
      setLoading(true);
      setError('');
      setSearch('');
      try {
        const loaderForApi = config.loader === 'Vanilla' ? '' : config.loader.toLowerCase();
        const res = await window.grom.getPopularByType(config.version, loaderForApi, tab);
        if (Array.isArray(res)) {
          setResults(res);
          setIsPopular(true);
        } else if (res && res.error) {
          setError(res.error);
        }
      } catch (err: any) {
        setError(err.message || 'Ошибка');
      } finally {
        setLoading(false);
      }
    })();
  }, [tab, config.version, config.loader]);

  const handleSearch = async () => {
    if (!search.trim()) {
      setLoading(true);
      try {
        const loaderForApi = config.loader === 'Vanilla' ? '' : config.loader.toLowerCase();
        const res = await window.grom.getPopularByType(config.version, loaderForApi, tab);
        if (Array.isArray(res)) { setResults(res); setIsPopular(true); }
      } catch {}
      finally { setLoading(false); }
      return;
    }

    setLoading(true); setError(''); setResults([]);
    try {
      const loaderForApi = config.loader === 'Vanilla' ? '' : config.loader.toLowerCase();
      const res = await window.grom.searchMods(search, config.version, loaderForApi, tab);
      if (res && res.error) setError(res.error);
      else if (Array.isArray(res)) {
        setResults(res);
        setIsPopular(false);
        if (res.length === 0) setError('Ничего не найдено.');
      }
    } catch (err: any) {
      setError(err.message || 'Ошибка');
    } finally {
      setLoading(false);
    }
  };

  const handleInstall = async (item: any) => {
    if (tab === 'mod') {
      const compat = await window.grom.getModCompatibleVersions(item.id);
      if ('error' in compat) { toast('Ошибка: ' + compat.error); return; }

      const { gameVersions, loaders } = compat;
      if (gameVersions.length === 0) { toast('Нет версий'); return; }

      const modLoaders = loaders.filter((l) => l.toLowerCase() !== 'vanilla');
      if (modLoaders.length === 0) { toast('Нет загрузчика'); return; }

      openModal({
        title: `Установить "${item.name}"`,
        fields: [
          {
            key: 'version',
            label: `Версия Minecraft (${gameVersions.length})`,
            type: 'select',
            options: gameVersions,
            default: gameVersions.includes(config.version) ? config.version : gameVersions[0],
          },
          {
            key: 'loader',
            label: `Загрузчик (${modLoaders.length})`,
            type: 'select',
            options: modLoaders,
            default: modLoaders.includes(config.loader.toLowerCase()) ? config.loader.toLowerCase() : modLoaders[0],
          },
        ],
        confirmText: 'Установить',
        onConfirm: async (values) => {
          const res = await window.grom.installByType(item.id, values.version, values.loader, 'mod', activeInstance);
          if (res.success) { toast('Мод установлен!'); await refreshInstances(); }
          else toast('Ошибка: ' + res.error);
        },
      });
      return;
    }

    const compat = await window.grom.getModCompatibleVersions(item.id);
    if ('error' in compat) { toast('Ошибка: ' + compat.error); return; }

    const { gameVersions } = compat;
    if (gameVersions.length === 0) { toast('Нет версий'); return; }

    openModal({
      title: `Установить "${item.name}"`,
      fields: [
        {
          key: 'version',
          label: `Версия Minecraft (${gameVersions.length})`,
          type: 'select',
          options: gameVersions,
          default: gameVersions.includes(config.version) ? config.version : gameVersions[0],
        },
      ],
      confirmText: 'Установить',
      onConfirm: async (values) => {
        const res = await window.grom.installByType(item.id, values.version, '', tab);
        if (res.success) toast(`${tab === 'resourcepack' ? 'Ресурспак' : 'Шейдер'} установлен!`);
        else toast('Ошибка: ' + res.error);
      },
    });
  };

  const tabLabels: Record<AddonTab, string> = {
    mod: 'Моды',
    resourcepack: 'Ресурспаки',
    shader: 'Шейдеры',
  };

  const placeholderByTab: Record<AddonTab, string> = {
    mod: 'Поиск модов...',
    resourcepack: 'Поиск ресурспаков...',
    shader: 'Поиск шейдеров...',
  };

  return (
    <div>
      <h1>Дополнения</h1>

      <div className="addons-tabs">
        {(['mod', 'resourcepack', 'shader'] as AddonTab[]).map((t) => (
          <button
            key={t}
            className={`addons-tab ${tab === t ? 'active' : ''}`}
            onClick={() => setTab(t)}
          >
            {tabLabels[t]}
          </button>
        ))}

        <button
          className="small-button"
          style={{ marginLeft: 'auto' }}
          onClick={() => window.grom.openContentFolder(tab)}
        >
          Открыть папку
        </button>
      </div>

      {tab === 'mod' && (
        <p className="hint" style={{ marginBottom: 12 }}>
          Активная сборка: <strong>{activeInstance || 'Основная папка'}</strong>
        </p>
      )}

      {tab === 'mod' && (
        <div onDragOver={(e) => { e.preventDefault(); setDragOver(true); }} onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragOver(false); }} onDrop={async (e) => {
          e.preventDefault(); setDragOver(false); setLocalModMessage('');
          const files = Array.from(e.dataTransfer.files) as (File & { path?: string })[];
          const jars = files.filter(f => f.name.toLowerCase().endsWith('.jar') && f.path);
          if (!jars.length) { setLocalModMessage('Перетащи сюда файл мода .jar. Другие форматы не поддерживаются.'); return; }
          setImportingLocalMod(true); const outcomes: string[] = [];
          for (const file of jars) { const result = await window.grom.importLocalMod(file.path!, activeInstance || undefined); outcomes.push(result.success ? `${result.filename}${result.duplicate ? ' — уже добавлен' : ' — добавлен'}` : `${file.name} — ${result.error || 'ошибка'}`); }
          setLocalModMessage(outcomes.join(' · ')); setImportingLocalMod(false); refreshInstances();
        }} style={{ marginTop: 12, padding: '18px 20px', border: `2px dashed ${dragOver ? 'var(--accent)' : 'rgba(255,255,255,.22)'}`, borderRadius: 12, background: dragOver ? 'rgba(150,90,255,.12)' : 'rgba(0,0,0,.12)', textAlign: 'center', transition: 'all .15s' }}>
          <strong>{importingLocalMod ? 'Добавляем моды…' : dragOver ? 'Отпусти файлы — добавим в mods' : '＋ Перетащи сюда свои моды'}</strong>
          <p className="hint" style={{ margin: '6px 0 0' }}>Только .jar · Папка: {activeInstance ? `сборка «${activeInstance}»` : 'основная папка Minecraft'}</p>
          {localModMessage && <p style={{ margin: '10px 0 0', fontSize: 12, overflowWrap: 'anywhere' }}>{localModMessage}</p>}
        </div>
      )}

      <div style={{ display: 'flex', gap: 12, marginTop: 12 }}>
        <input
          className="form-input"
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
          placeholder={placeholderByTab[tab]}
          style={{ flex: 1 }}
        />
        <button className="small-button" style={{ width: 120 }} onClick={handleSearch}>
          {loading ? 'Поиск...' : 'Найти'}
        </button>
      </div>

      {isPopular && !loading && (
        <p className="hint" style={{ marginTop: 8 }}>
          Популярное на Modrinth — {tabLabels[tab]}
        </p>
      )}

      {error && (
        <div style={{ marginTop: 12, padding: 12, background: 'rgba(255,107,26,0.12)', border: '2px solid var(--accent)', borderRadius: 8, color: 'var(--accent)', fontSize: 13 }}>
          {error}
        </div>
      )}

      <div className="mods-list" style={{ marginTop: 16 }}>
        {results.map((item) => (
          <div key={item.id} className="mod-card">
            <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
              {item.icon && <img src={item.icon} alt="" style={{ width: 40, height: 40, borderRadius: 6 }} />}
              <div>
                <h3>{item.name}</h3>
                <p>{item.description}</p>
              </div>
            </div>
            <button className="small-button" style={{ width: 120 }} onClick={() => handleInstall(item)}>
              Установить
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════
// MODPACKS PAGE
// ═══════════════════════════════════════════════════════
function ModpacksPage({ config, instances, refreshInstances, openModal }: { config: GromConfig; instances: Instance[]; refreshInstances: () => void; openModal: ModalOpener }) {
  const [search, setSearch] = useState('');
  const [results, setResults] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedInstance, setSelectedInstance] = useState('');

  const handleSearch = async () => {
    if (!search.trim()) return;
    setLoading(true);
    try {
      const res = await window.grom.searchModpacks(search, config.version);
      if (!res.error) setResults(res);
    } catch {}
    finally { setLoading(false); }
  };

  const handleDownload = async (modpack: any) => {
    if (!selectedInstance) { toast('Выбери сборку'); return; }
    const res = await window.grom.downloadModpack(modpack.id, config.version, selectedInstance);
    if (res.success) { toast('Скачано!'); await refreshInstances(); }
    else toast('Ошибка: ' + res.error);
  };

  const handleDelete = (name: string) => {
    openModal({
      title: `Удалить сборку "${name}"?`,
      fields: [], confirmText: 'Удалить',
      onConfirm: async () => {
        const res = await window.grom.deleteInstance(name);
        if (res.success) { await refreshInstances(); if (selectedInstance === name) setSelectedInstance(''); toast('Удалено'); }
      },
    });
  };

  const handleExport = async (name: string) => {
    const res = await window.grom.exportMrpack(name);
    if (res.success) toast('Экспортировано!');
    else if (res.error) toast('Ошибка: ' + res.error);
  };

  const handleImport = async () => {
    const res = await window.grom.importMrpack();
    if (res.success) {
      toast('Импортировано: ' + res.instanceName);
      await refreshInstances();
    } else if (res.error) {
      toast('Ошибка: ' + res.error);
    }
  };

  return (
    <div>
      <h1>Сборки</h1>
      <div className="settings-section">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <h2 style={{ margin: 0 }}>Мои сборки ({instances.length})</h2>
          <button className="small-button" onClick={handleImport}>Импорт .mrpack</button>
        </div>
        {instances.length === 0 && <p className="hint">Пока нет сборок.</p>}
        {instances.map((inst) => (
          <div key={inst.name} className="instance-row">
            <div><strong>{inst.name}</strong><span className="hint">{inst.version} • {inst.loader} • {inst.modsCount} модов</span></div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="small-button" onClick={() => handleExport(inst.name)}>Экспорт</button>
              <button className="small-button" onClick={() => handleDelete(inst.name)}>Удалить</button>
            </div>
          </div>
        ))}
      </div>
      <div className="settings-section">
        <h2>Скачать сборку с Modrinth</h2>
        <div style={{ display: 'flex', gap: 12, marginTop: 12 }}>
          <input className="form-input" type="text" value={search} onChange={(e) => setSearch(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && handleSearch()} placeholder="Поиск сборок..." style={{ flex: 1 }} />
          <button className="small-button" style={{ width: 120 }} onClick={handleSearch}>{loading ? 'Поиск...' : 'Найти'}</button>
        </div>
        <div style={{ marginTop: 12 }}>
          <label>Куда скачать:</label>
          <select value={selectedInstance} onChange={(e) => setSelectedInstance(e.target.value)}>
            <option value="">Выбери сборку</option>
            {instances.map((inst) => <option key={inst.name} value={inst.name}>{inst.name}</option>)}
          </select>
        </div>
        <div className="mods-list" style={{ marginTop: 16 }}>
          {results.map((pack) => (
            <div key={pack.id} className="mod-card">
              <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                {pack.icon && <img src={pack.icon} alt="" style={{ width: 40, height: 40, borderRadius: 6 }} />}
                <div><h3>{pack.name}</h3><p>{pack.description}</p></div>
              </div>
              <button className="small-button" style={{ width: 120 }} onClick={() => handleDownload(pack)}>Скачать</button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════
// WORLDS PAGE
// ═══════════════════════════════════════════════════════
function WorldsPage({ config, activeInstance, openModal }: { config: GromConfig; activeInstance: string; openModal: ModalOpener }) {
  const [worlds, setWorlds] = useState<WorldInfo[]>([]);
  const [screenshots, setScreenshots] = useState<ScreenshotInfo[]>([]);
  const [tab, setTab] = useState<'worlds' | 'screenshots'>('worlds');
  const [selectedScreenshot, setSelectedScreenshot] = useState<ScreenshotInfo | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = async () => {
    setLoading(true);
    const w = await window.grom.listWorlds(activeInstance || undefined);
    const s = await window.grom.listScreenshots(activeInstance || undefined);
    setWorlds(w);
    setScreenshots(s);
    setLoading(false);
  };

  useEffect(() => { refresh(); }, [activeInstance]);

  const handleDelete = (world: WorldInfo) => {
    openModal({
      title: `Удалить мир "${world.name}"?`,
      fields: [], confirmText: 'Удалить',
      onConfirm: async () => {
        const res = await window.grom.deleteWorld(world.path);
        if (res.success) { toast('Мир удалён'); await refresh(); }
        else toast('Ошибка: ' + res.error);
      },
    });
  };

  const handleBackup = async (world: WorldInfo) => {
    const res = await window.grom.backupWorld(world.path);
    if (res.success) toast('Бэкап создан: ' + res.path);
    else toast('Ошибка: ' + res.error);
  };

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return bytes + ' Б';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' КБ';
    if (bytes < 1024 * 1024 * 1024) return (bytes / 1024 / 1024).toFixed(1) + ' МБ';
    return (bytes / 1024 / 1024 / 1024).toFixed(2) + ' ГБ';
  };

  const formatDate = (iso: string | null) => {
    if (!iso) return '—';
    const d = new Date(iso);
    return d.toLocaleDateString('ru-RU') + ' ' + d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  };

  return (
    <div>
      <h1>Миры и скриншоты</h1>
      <p className="hint" style={{ marginBottom: 12 }}>Активная сборка: <strong>{activeInstance || 'Основная папка'}</strong></p>

      <div className="source-tabs" style={{ marginBottom: 16 }}>
        <button className={tab === 'worlds' ? 'active' : ''} onClick={() => setTab('worlds')}>Миры ({worlds.length})</button>
        <button className={tab === 'screenshots' ? 'active' : ''} onClick={() => setTab('screenshots')}>Скриншоты ({screenshots.length})</button>
      </div>

      {loading && <p className="hint">Загрузка...</p>}

      {!loading && tab === 'worlds' && (
        <>
          {worlds.length === 0 && <p className="hint">Миров пока нет. Запусти игру и создай мир.</p>}
          {worlds.map((world) => (
            <div key={world.path} className="world-row">
              <div className="world-icon">
                {world.icon ? <img src={world.icon} alt="" /> : <span>?</span>}
              </div>
              <div className="world-info">
                <strong>{world.name}</strong>
                <span className="hint">{formatSize(world.sizeBytes)} • {formatDate(world.lastPlayed)}</span>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="small-button" onClick={() => handleBackup(world)}>Бэкап</button>
                <button className="small-button" onClick={() => handleDelete(world)}>Удалить</button>
              </div>
            </div>
          ))}
        </>
      )}

      {!loading && tab === 'screenshots' && (
        <>
          {screenshots.length === 0 && <p className="hint">Скриншотов пока нет. Нажми F2 в игре.</p>}
          <div className="screenshots-grid">
            {screenshots.map((s) => (
              <div key={s.name} className="screenshot-card" onClick={() => setSelectedScreenshot(s)}>
                <img src={s.dataUrl} alt={s.name} />
                <span className="hint">{formatDate(s.date)}</span>
              </div>
            ))}
          </div>
        </>
      )}

      {selectedScreenshot && (
        <div className="modal-overlay" onClick={() => setSelectedScreenshot(null)}>
          <div className="screenshot-full" onClick={(e) => e.stopPropagation()}>
            <img src={selectedScreenshot.dataUrl} alt="" />
            <p className="hint">{selectedScreenshot.name}</p>
            <button className="small-button" onClick={() => setSelectedScreenshot(null)}>Закрыть</button>
          </div>
        </div>
      )}
    </div>
  );
}



// ═══════════════════════════════════════════════════════
// SETTINGS PAGE
// ═══════════════════════════════════════════════════════
interface SettingsProps extends PageProps {
  fontData: FontItem | null;
  setFontData: (f: FontItem | null) => void;
  setBackgroundUrl: (url: string) => void;
}

function SettingsPage({ config, updateConfig, fontData, setFontData, setBackgroundUrl }: SettingsProps) {
  const [totalRam, setTotalRam] = useState(8192);
  const [gameDir, setGameDir] = useState('');
  const [backgrounds, setBackgrounds] = useState<BackgroundItem[]>([]);

  useEffect(() => {
    (async () => {
      const ram = await window.grom.getTotalRam();
      const dir = await window.grom.getGameDir();
      const bgs = await window.grom.listBackgrounds();
      setTotalRam(ram); setGameDir(dir); setBackgrounds(bgs);
    })();
  }, []);

  const resolutions = [
    { w: 854, h: 480, label: '854 × 480' },
    { w: 1280, h: 720, label: '1280 × 720 (HD)' },
    { w: 1920, h: 1080, label: '1920 × 1080 (Full HD)' },
    { w: 2560, h: 1440, label: '2560 × 1440 (2K)' },
    { w: 3840, h: 2160, label: '3840 × 2160 (4K)' },
  ];

  const handlePickBackground = (bg: BackgroundItem | null) => {
    if (bg === null) { updateConfig('background', 'none'); setBackgroundUrl(''); }
    else { updateConfig('background', bg.name); setBackgroundUrl(bg.dataUrl); }
  };

  const handlePickFont = async () => {
    const font = await window.grom.pickFont();
    if (font) { setFontData(font); injectFont(font); toast('Шрифт загружен'); }
  };

  const handleResetFont = () => {
    setFontData(null);
    updateConfig('customFontPath', null);
    const el = document.getElementById('grom-custom-font');
    if (el) el.remove();
    toast('Шрифт сброшен');
  };

  const [maintenanceStats, setMaintenanceStats] = useState<any>(null);
  const [diagnosis, setDiagnosis] = useState<any>(null);
  const [modScan, setModScan] = useState<any[] | null>(null);
  const [repairCheck, setRepairCheck] = useState<any>(null);
  const [repairProgress, setRepairProgress] = useState<{ message: string; progress: number } | null>(null);
  const [maintenanceBusy, setMaintenanceBusy] = useState(false);
  useEffect(() => {
    const unsubscribe = window.grom.onGameStatus((data) => {
      if (data.stage === 'installing') setRepairProgress({ message: data.message, progress: Math.max(0, Math.min(100, data.progress ?? 0)) });
    });
    return unsubscribe;
  }, []);
  const runMaintenance = async (task: 'stats' | 'diagnose' | 'scan' | 'repair') => {
    setMaintenanceBusy(true);
    try {
      if (task === 'stats') setMaintenanceStats(await window.grom.maintenance.stats());
      if (task === 'diagnose') setDiagnosis(await window.grom.maintenance.diagnose());
      if (task === 'scan') setModScan(await window.grom.maintenance.scanMods());
      if (task === 'repair') {
        setRepairCheck(null);
        setRepairProgress({ message: `Проверка Minecraft ${config.version}…`, progress: 0 });
        const result = await window.grom.maintenance.checkMinecraft(config.version);
        setRepairCheck(result);
        if (!result.ok) toast(result.message);
        else toast(`Файлы Minecraft ${config.version} проверены`);
      }
    } catch (e: any) { toast(e?.message || 'Не удалось выполнить проверку'); }
    finally { setMaintenanceBusy(false); }
  };

  const handleAutoRam = () => {
    let recommended = 2048;
    if (totalRam >= 16384) recommended = 4096;
    else if (totalRam >= 8192) recommended = 3072;
    else if (totalRam >= 4096) recommended = 2048;
    else recommended = 1024;
    updateConfig('ram', recommended);
    toast(`Рекомендовано: ${recommended} МБ`);
  };

  return (
    <div>
      <h1>Настройки</h1>

      <div className="settings-section">
        <h2>Статистика игры</h2>
        <button className="small-button" disabled={maintenanceBusy} onClick={() => runMaintenance('stats')}>Показать статистику</button>
        {maintenanceStats && <p className="hint" style={{ marginTop: 10 }}>Учтено запусков: {maintenanceStats.launches} · Суммарное время: {Math.floor(maintenanceStats.totalDurationMs / 3600000)} ч {Math.floor((maintenanceStats.totalDurationMs % 3600000) / 60000)} мин. Статистика начинается после установки этой версии.</p>}
      </div>
      <div className="settings-section">
        <h2>Диагностика вылетов</h2>
        <button className="small-button" disabled={maintenanceBusy} onClick={() => runMaintenance('diagnose')}>Проанализировать логи</button>
        {diagnosis && <div style={{ marginTop: 10 }}><p>{diagnosis.summary}</p><p className="hint">{diagnosis.file ? `${diagnosis.file} · ${diagnosis.modifiedAt}` : 'Файл не найден'}</p>{diagnosis.findings?.map((f: string, i: number) => <p key={i} className="hint">• {f}</p>)}</div>}
      </div>
      <div className="settings-section">
        <h2>Проверка модов</h2>
        <button className="small-button" disabled={maintenanceBusy} onClick={() => runMaintenance('scan')}>Проверить папку mods</button>
        {modScan && <div style={{ marginTop: 10 }}><p className="hint">JAR-файлов: {modScan.length}. Это проверка SHA-256 и простых подозрительных признаков, а не антивирус.</p>{modScan.slice(0, 30).map((m: any) => <div key={m.name} style={{ padding: '8px 0', borderBottom: '1px solid rgba(255,255,255,.1)' }}><strong>{m.name}</strong><p className="hint" style={{ overflowWrap: 'anywhere' }}>SHA-256: {m.sha256}{m.warnings.length ? ` · ⚠ ${m.warnings.join(', ')}` : ' · простых признаков не обнаружено'}</p></div>)}</div>}
      </div>
      <div className="settings-section">
        <h2>Восстановление Minecraft</h2>
        <p className="hint" style={{ marginBottom: 12 }}>Проверяет выбранную версию {config.version || 'Minecraft'} и скачивает отсутствующие или повреждённые клиентские файлы, библиотеки и ресурсы.</p>
        <button className="small-button" disabled={maintenanceBusy || !config.version} onClick={() => runMaintenance('repair')}>{maintenanceBusy ? 'Проверяем файлы…' : 'Проверить и восстановить'}</button>
        {maintenanceBusy && repairProgress && <div className="repair-progress-v2"><div><span>{repairProgress.message}</span><b>{repairProgress.progress}%</b></div><div className="repair-progress-track-v2"><i style={{ width: `${repairProgress.progress}%` }} /></div></div>}
        {repairCheck && <div style={{ marginTop: 12 }}><p className={repairCheck.ok ? 'repair-success-v2' : 'repair-error-v2'}>{repairCheck.message}</p>{repairCheck.results.map((r: any) => <p key={r.name} className="hint">{r.exists && r.isDirectory ? '✓' : '⚠'} {r.name}: {r.exists && r.isDirectory ? 'найдена' : 'отсутствует'}</p>)}</div>}
      </div>

      <FpsBoostSection config={config} updateConfig={updateConfig} />

      <GpuSection config={config} updateConfig={updateConfig} />

      <AppIconSection config={config} updateConfig={updateConfig} />

      <div className="settings-section">
        <h2>Тема</h2>
        <div className="theme-grid">
          <div className={`theme-card ${config.theme === 'forest' ? 'active' : ''}`} onClick={() => updateConfig('theme', 'forest')}><div className="theme-preview theme-forest" /><span>Лес</span></div>
          <div className={`theme-card ${config.theme === 'grom' ? 'active' : ''}`} onClick={() => updateConfig('theme', 'grom')}><div className="theme-preview theme-grom" /><span>Гром</span></div>
          <div className={`theme-card ${config.theme === 'light' ? 'active' : ''}`} onClick={() => updateConfig('theme', 'light')}><div className="theme-preview theme-light" /><span>Светлая</span></div>
          <div className={`theme-card ${config.theme === 'midnight' ? 'active' : ''}`} onClick={() => updateConfig('theme', 'midnight')}><div className="theme-preview theme-midnight" /><span>Полночь</span></div>
        </div>
      </div>

      <div className="settings-section">
        <h2>Питомец</h2>
        <label className="checkbox-row">
          <input type="checkbox" checked={config.petEnabled} onChange={(e) => updateConfig('petEnabled', e.target.checked)} />
          Показывать питомца
        </label>
        <div className="form-group" style={{ marginTop: 12 }}>
          <label>Тип питомца</label>
          <select value={config.petType} onChange={(e) => updateConfig('petType', e.target.value)}>
            <option value="bee">Пчела</option>
          </select>
        </div>
        <p className="hint">Питомец живёт в углу экрана</p>
      </div>

      <div className="settings-section">
        <h2>Фон</h2>
        <div className="bg-grid">
          <div className={`bg-card ${config.background === 'none' ? 'active' : ''}`} onClick={() => handlePickBackground(null)}>
            <div className="bg-preview bg-none">Нет</div><span>Без фона</span>
          </div>
          {backgrounds.map((bg) => (
            <div key={bg.name} className={`bg-card ${config.background === bg.name ? 'active' : ''}`} onClick={() => handlePickBackground(bg)}>
              <div className="bg-preview" style={{ backgroundImage: `url(${bg.dataUrl})` }} /><span>{bg.name.replace('bg-', '')}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="settings-section">
        <h2>Шрифт</h2>
        {fontData ? (
          <div className="font-info"><span>Текущий: <strong>{fontData.name}</strong></span><button className="small-button" onClick={handleResetFont}>Сбросить</button></div>
        ) : <p className="hint">Системный шрифт</p>}
        <button className="small-button" style={{ marginTop: 12 }} onClick={handlePickFont}>Загрузить свой шрифт</button>
      </div>

      <div className="settings-section">
        <h2>Игра</h2>
        <h3 style={{ fontSize: 14, marginBottom: 10, color: 'var(--text-dim)' }}>ОЗУ</h3>
        <div className="ram-control">
          <input type="range" min={512} max={totalRam} step={256} value={config.ram} onChange={(e) => updateConfig('ram', parseInt(e.target.value))} />
          <input type="number" min={512} max={totalRam} step={256} value={config.ram} onChange={(e) => updateConfig('ram', parseInt(e.target.value) || 512)} className="ram-number" />
          <span className="ram-unit">МБ</span>
        </div>
        <button className="small-button" style={{ marginTop: 8 }} onClick={handleAutoRam}>
          Рекомендовать автоматически
        </button>
        <span className="hint">Доступно: {totalRam} МБ</span>

        <h3 style={{ fontSize: 14, marginTop: 20, marginBottom: 10, color: 'var(--text-dim)' }}>Разрешение</h3>
        <select value={`${config.width} × ${config.height}`} onChange={(e) => {
          const [w, h] = e.target.value.split(' × ').map((s) => parseInt(s));
          if (!isNaN(w) && !isNaN(h)) { updateConfig('width', w); updateConfig('height', h); }
        }}>
          {resolutions.map((r) => <option key={r.label} value={`${r.w} × ${r.h}`}>{r.label}</option>)}
        </select>
        <label className="checkbox-row"><input type="checkbox" checked={config.fullscreen} onChange={(e) => updateConfig('fullscreen', e.target.checked)} />Полноэкранный режим</label>
      </div>

      <div className="settings-section">
        <h2>Папка игры</h2>
        <div className="folder-row">
          <input type="text" value={gameDir} readOnly />
          <button className="small-button" onClick={() => window.grom.openFolder('game')}>Открыть</button>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════
// ABOUT PAGE
// ═══════════════════════════════════════════════════════
function AboutPage({ config }: { config: GromConfig }) {
  const [adminStep, setAdminStep] = useState<'closed' | 'code' | 'panel'>('closed');
  const [code, setCode] = useState('');
  const [adminSessionCode, setAdminSessionCode] = useState('');
  const [checking, setChecking] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [version, setVersion] = useState('1.4.5');
  const [features, setFeatures] = useState('Исправления ошибок и улучшение стабильности');
  const [required, setRequired] = useState(true);
  const [status, setStatus] = useState('');

  const verifyCode = async () => {
    setChecking(true); setStatus('');
    try {
      const { data, error } = await supabase.functions.invoke('grom-control', { body: { action: 'authorize', code } });
      if (error) throw error;
      if (!data?.authorized) { setStatus('Неверный код или админ-панель не настроена.'); return; }
      setAdminStep('panel'); setAdminSessionCode(code); setCode('');
      const current = await fetchLauncherControl();
      if (current) { setVersion(current.version || '1.4.5'); setFeatures((current.features || []).join('\n')); setRequired(Boolean(current.required)); }
    } catch (e: any) { setStatus(e?.message || 'Не удалось проверить код.'); }
    finally { setChecking(false); }
  };

  const publish = async () => {
    setPublishing(true); setStatus('');
    try {
      const { data, error } = await supabase.functions.invoke('grom-control', {
        body: { action: 'publish', code: adminSessionCode, version: version.trim(), features: features.split('\n').map(x => x.trim()).filter(Boolean), required, websiteUrl: 'https://gromclient.devs.li' }
      });
      if (error) throw error;
      if (!data?.success) throw new Error(data?.error || 'Не удалось опубликовать объявление.');
      setStatus('Обновление опубликовано. Лаунчеры получат его при следующей проверке.');
    } catch (e: any) { setStatus(e?.message || 'Не удалось опубликовать обновление.'); }
    finally { setPublishing(false); }
  };

  return (
    <div className="about-page">
      <h1>О программе</h1>
      <button type="button" className="about-brand-icon-button" onClick={() => { setAdminStep('code'); setStatus(''); }} title="Администрирование">
        <div className="about-brand-icon-wrap"><BrandIcon iconKey={config.appIcon} theme={config.theme} className="about-logo about-brand-icon" /></div>
      </button>
      <h2>Grom Client</h2>
      <p>Версия 1.4.5</p>
      <p style={{ marginTop: 20 }}>Создатель: <strong>B0DR0DEV</strong></p>
      <p><a href="https://gromclient.devs.li" onClick={(e) => { e.preventDefault(); void window.grom.openExternal('https://gromclient.devs.li'); }}>Gromclient.devs.li</a></p>

      {adminStep !== 'closed' && <div className="grom-admin-backdrop" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget) setAdminStep('closed'); }}>
        <section className="grom-admin-dialog" role="dialog" aria-modal="true" aria-label="Панель администратора">
          <button className="grom-admin-close" onClick={() => setAdminStep('closed')} aria-label="Закрыть">×</button>
          {adminStep === 'code' ? <>
            <h2>Доступ разработчика</h2>
            <p>Введите код администратора.</p>
            <input type="password" autoFocus value={code} onChange={e => setCode(e.target.value)} onKeyDown={e => e.key === 'Enter' && verifyCode()} placeholder="Код доступа" />
            <button className="play-button" disabled={checking || !code.trim()} onClick={verifyCode}>{checking ? 'Проверка…' : 'Открыть панель'}</button>
          </> : <>
            <h2>Управление обновлением</h2>
            <label>Версия лаунчера</label><input value={version} onChange={e => setVersion(e.target.value)} placeholder="1.4.5" />
            <label>Новые функции и изменения (по одному на строку)</label><textarea value={features} onChange={e => setFeatures(e.target.value)} rows={5} />
            <label className="grom-admin-check"><input type="checkbox" checked={required} onChange={e => setRequired(e.target.checked)} /> Обязательное обновление (блокировать лаунчер до перехода на сайт)</label>
            <button className="play-button" disabled={publishing || !version.trim() || !features.trim()} onClick={publish}>{publishing ? 'Публикация…' : 'Опубликовать новую версию'}</button>
          </>}
          {status && <p className="grom-admin-status" role="status">{status}</p>}
          <p className="grom-admin-footnote">Код проверяется сервером и не хранится в клиентском интерфейсе.</p>
        </section>
      </div>}
    </div>
  );
}

async function fetchLauncherControl(): Promise<any | null> {
  try {
    const { data, error } = await supabase.functions.invoke('grom-control', { body: { action: 'status' } });
    if (error || !data?.status) return null;
    return data.status;
  } catch { return null; }
}

function ReleaseGate() {
  const [release, setRelease] = useState<any | null>(null);
  const [checked, setChecked] = useState(false);
  useEffect(() => {
    let alive = true;
    const check = async () => {
      const status = await fetchLauncherControl();
      if (alive) { setRelease(status); setChecked(true); }
    };
    void check();
    const id = window.setInterval(() => { void check(); }, 60_000);
    return () => { alive = false; window.clearInterval(id); };
  }, []);
  if (!checked || !release?.required || !release?.version || release.version === '1.4.5') return null;
  return <div className="grom-release-backdrop" role="alertdialog" aria-modal="true" aria-labelledby="grom-release-title">
    <section className="grom-release-dialog">
      <div className="grom-release-icon">↻</div>
      <h2 id="grom-release-title">Требуется обновление Grom Client</h2>
      <p>Чтобы продолжить пользоваться лаунчером, установи новую версию <strong>{release.version}</strong>.</p>
      {Array.isArray(release.features) && release.features.length > 0 && <div className="grom-release-features"><strong>Что нового</strong><ul>{release.features.map((item: string, i: number) => <li key={i}>{item}</li>)}</ul></div>}
      <button className="play-button" onClick={() => void window.grom.openExternal('https://gromclient.devs.li')}>Открыть официальный сайт</button>
      <small>Ссылка: gromclient.devs.li</small>
    </section>
  </div>;
}

// ═══════════════════════════════════════════════════════
// FPS BOOST SECTION
// ═══════════════════════════════════════════════════════
function FpsBoostSection({ config, updateConfig }: { config: GromConfig; updateConfig: (key: keyof GromConfig, value: any) => void }) {
  const [fpsMods, setFpsMods] = useState<FpsMod[]>([]);
  const [detect, setDetect] = useState<FpsDetect | null>(null);
  const [installed, setInstalled] = useState<Record<string, boolean>>({});
  const [showModsList, setShowModsList] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [progress, setProgress] = useState(0);
  const [statusMsg, setStatusMsg] = useState('');
  const [showFabricPrompt, setShowFabricPrompt] = useState(false);

  useEffect(() => {
    (async () => {
      const mods = await window.grom.fps.getMods();
      setFpsMods(mods);
      const d = await window.grom.fps.detect();
      setDetect(d);
      const inst = await window.grom.fps.checkMods();
      setInstalled(inst);
    })();

    const unsub = window.grom.onGameStatus((data) => {
      if (data.stage === 'installing') {
        setStatusMsg(data.message);
        if (data.progress !== undefined) setProgress(data.progress);
      }
    });
    return unsub;
  }, []);

  const installedCount = Object.values(installed).filter(Boolean).length;
  const totalCount = fpsMods.length;

  const handleOptimize = async () => {
    if (!config.version) { toast('Сначала выбери версию на Главной'); return; }

    if (config.fpsBoostMods && config.loader === 'Vanilla') {
      setShowFabricPrompt(true);
      return;
    }

    await runOptimize();
  };

  const runOptimize = async () => {
    setInstalling(true);
    setProgress(0);
    setStatusMsg('Подготовка...');

    if (config.fpsBoostAutoRam && detect) {
      updateConfig('ram', detect.recommendedRam);
    }

    if (config.fpsBoostMods) {
      const selectedSlugs = fpsMods.map((m) => m.slug);
      const res = await window.grom.fps.install(config.version, config.loader, selectedSlugs);
      if (res.success) {
        const newInstalled = await window.grom.fps.checkMods();
        setInstalled(newInstalled);
        if (res.failed && res.failed.length > 0) {
          toast(`Установлено ${res.installed?.length || 0} модов, ошибок: ${res.failed.length}`);
        } else {
          toast(`Установлено ${res.installed?.length || 0} модов производительности`);
        }
      } else {
        toast('Ошибка: ' + res.error);
        setInstalling(false);
        return;
      }
    }

    updateConfig('fpsBoostEnabled', true);

    setStatusMsg('Готово!');
    setProgress(100);
    toast('FPS Boost активирован! Запусти игру и проверь FPS.');
    setInstalling(false);
  };

  const handleInstallFabric = async () => {
    setShowFabricPrompt(false);
    setInstalling(true);
    setStatusMsg('Установка Fabric...');
    const res = await window.grom.installLoader('Fabric', config.version);
    if (res.success) {
      updateConfig('loader', 'Fabric');
      toast('Fabric установлен! Устанавливаю моды...');
      await runOptimize();
    } else {
      toast('Ошибка установки Fabric: ' + (res.error || ''));
      setInstalling(false);
    }
  };

  const handleOnlyFlags = async () => {
    setShowFabricPrompt(false);
    updateConfig('fpsBoostMods', false);
    await runOptimize();
  };

  const handleUninstall = async () => {
    const res = await window.grom.fps.uninstall();
    if (res.success) {
      const newInstalled = await window.grom.fps.checkMods();
      setInstalled(newInstalled);
      toast(`Удалено модов: ${res.removed || 0}`);
    } else {
      toast('Ошибка: ' + res.error);
    }
  };

  return (
    <div className="settings-section fps-boost-section">
      <h2>⚡ FPS BOOST</h2>

      {detect && (
        <div className="fps-pc-info">
          <div className="fps-pc-row">
            <span className="hint">ОЗУ системы:</span>
            <strong>{(detect.totalRamMB / 1024).toFixed(1)} ГБ</strong>
          </div>
          <div className="fps-pc-row">
            <span className="hint">Уровень ПК:</span>
            <strong className={`fps-level fps-level-${detect.level}`}>
              {detect.level === 'low' ? 'Слабый' : detect.level === 'mid' ? 'Средний' : 'Мощный'}
            </strong>
          </div>
          <div className="fps-pc-row">
            <span className="hint">Рекомендуемое ОЗУ:</span>
            <strong>{detect.recommendedRam} МБ</strong>
          </div>
          <div className="fps-pc-row">
            <span className="hint">Установлено модов:</span>
            <strong>{installedCount} / {totalCount}</strong>
          </div>
        </div>
      )}

      <div className="fps-options">
        <label className="checkbox-row">
          <input
            type="checkbox"
            checked={config.fpsBoostAikar}
            onChange={(e) => updateConfig('fpsBoostAikar', e.target.checked)}
          />
          <span>Оптимальные JVM-аргументы (Aikar's Flags)</span>
        </label>

        <label className="checkbox-row">
          <input
            type="checkbox"
            checked={config.fpsBoostMods}
            onChange={(e) => updateConfig('fpsBoostMods', e.target.checked)}
          />
          <span>Моды производительности ({fpsMods.length} шт.)</span>
          <button
            type="button"
            className="small-button"
            style={{ marginLeft: 'auto', height: 24, padding: '0 10px', fontSize: 11 }}
            onClick={() => setShowModsList(!showModsList)}
          >
            {showModsList ? 'Скрыть' : 'Список'}
          </button>
        </label>

        <label className="checkbox-row">
          <input
            type="checkbox"
            checked={config.fpsBoostAutoRam}
            onChange={(e) => updateConfig('fpsBoostAutoRam', e.target.checked)}
          />
          <span>Автоподбор ОЗУ под ПК</span>
        </label>
      </div>

      {showModsList && (
        <div className="fps-mods-list">
          {fpsMods.map((mod) => (
            <div key={mod.slug} className="fps-mod-row">
              <span className={`fps-mod-check ${installed[mod.slug] ? 'installed' : ''}`}>
                {installed[mod.slug] ? '✓' : '○'}
              </span>
              <div className="fps-mod-info">
                <strong>{mod.name}</strong>
                <span className="hint">{mod.description}</span>
              </div>
            </div>
          ))}
        </div>
      )}

      {installing && (
        <div className="progress-panel" style={{ marginTop: 16 }}>
          <div className="progress-bar-wrapper">
            <div className="progress-bar-fill" style={{ width: `${progress}%` }} />
          </div>
          <span className="hint">{statusMsg} — {progress}%</span>
        </div>
      )}

      <div className="fps-actions">
        <button
          className="play-button"
          onClick={handleOptimize}
          disabled={installing}
        >
          {installing ? 'ОПТИМИЗАЦИЯ...' : 'ОПТИМИЗИРОВАТЬ В 1 КЛИК'}
        </button>
        {installedCount > 0 && (
          <button
            className="small-button"
            onClick={handleUninstall}
            disabled={installing}
            style={{ marginLeft: 12 }}
          >
            Удалить моды
          </button>
        )}
        <button
          className="small-button"
          onClick={() => window.grom.fps.openModsFolder()}
          style={{ marginLeft: 'auto' }}
        >
          Открыть папку модов
        </button>
      </div>

      {showFabricPrompt && (
        <div className="modal-overlay" onClick={() => setShowFabricPrompt(false)}>
          <div className="modal-box" onClick={(e) => e.stopPropagation()}>
            <h3>Нужен Fabric</h3>
            <p className="hint" style={{ marginBottom: 20 }}>
              Моды производительности работают только с Fabric. Установить его сейчас?
            </p>
            <div className="modal-buttons">
              <button className="small-button" onClick={handleOnlyFlags}>Только JVM-флаги</button>
              <button className="play-button" onClick={handleInstallFabric}>Установить Fabric</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════
// GPU SECTION
// ═══════════════════════════════════════════════════════
function GpuSection({ config, updateConfig }: { config: GromConfig; updateConfig: (key: keyof GromConfig, value: any) => void }) {
  const [status, setStatus] = useState<GpuStatus | null>(null);
  const [applying, setApplying] = useState(false);
  const [localMode, setLocalMode] = useState<'auto' | 'high' | 'low'>(config.gpuMode || 'high');

  const loadStatus = async () => {
    const s = await window.grom.gpu.status();
    setStatus(s);
  };

  useEffect(() => { loadStatus(); }, []);

  const handleApply = async () => {
    setApplying(true);
    const res = await window.grom.gpu.setMode(localMode);
    if (res.success) {
      updateConfig('gpuMode', localMode);
      await loadStatus();
      toast('Настройки GPU применены');
    } else {
      toast('Ошибка: ' + (res.error || 'неизвестно'));
    }
    setApplying(false);
  };

  const handleReset = async () => {
    setApplying(true);
    const res = await window.grom.gpu.setMode('high');
    if (res.success) {
      setLocalMode('high');
      updateConfig('gpuMode', 'high');
      await loadStatus();
      toast('Возвращено к High Performance');
    }
    setApplying(false);
  };

  const modeLabel = (mode: 'auto' | 'high' | 'low' | null) => {
    if (mode === 'high') return 'High Performance';
    if (mode === 'low') return 'Power Saving';
    if (mode === 'auto') return 'Auto';
    return 'не задано';
  };

  const isWindows = navigator.platform.toLowerCase().includes('win');

  return (
    <div className="settings-section gpu-section">
      <h2>Производительность GPU</h2>

      {!isWindows && <p className="hint">Настройка доступна только на Windows.</p>}

      {isWindows && (
        <>
          <div className="gpu-mode-group">
            <label className="gpu-mode-option">
              <input type="radio" name="gpu-mode" value="auto"
                checked={localMode === 'auto'}
                onChange={() => setLocalMode('auto')} />
              <div className="gpu-mode-content">
                <strong>Auto</strong>
                <span className="hint">Windows сам выбирает GPU</span>
              </div>
            </label>

            <label className="gpu-mode-option">
              <input type="radio" name="gpu-mode" value="high"
                checked={localMode === 'high'}
                onChange={() => setLocalMode('high')} />
              <div className="gpu-mode-content">
                <strong>High Performance</strong>
                <span className="hint">Дискретная видеокарта (NVIDIA / AMD Radeon RX)</span>
              </div>
            </label>

            <label className="gpu-mode-option">
              <input type="radio" name="gpu-mode" value="low"
                checked={localMode === 'low'}
                onChange={() => setLocalMode('low')} />
              <div className="gpu-mode-content">
                <strong>Power Saving</strong>
                <span className="hint">Встроенная видеокарта (экономия батареи)</span>
              </div>
            </label>
          </div>

          <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
            <button className="small-button" onClick={handleApply} disabled={applying}>
              {applying ? 'Применение...' : 'Применить'}
            </button>
            <button className="small-button" onClick={handleReset} disabled={applying}>
              Сбросить в High
            </button>
          </div>

          {status && (
            <div className="gpu-status-block">
              <h3 style={{ fontSize: 13, marginBottom: 8, color: 'var(--accent)' }}>Текущее состояние</h3>
              <div className="gpu-status-row">
                <span className="hint">Java:</span>
                <span className="gpu-status-value">
                  {status.java.length === 0 ? 'ещё не скачана' : modeLabel(status.java[0].mode)}
                </span>
              </div>
              <div className="gpu-status-row">
                <span className="hint">Лаунчер:</span>
                <span className="gpu-status-value">{modeLabel(status.launcher.mode)}</span>
              </div>
            </div>
          )}

          <p className="hint" style={{ marginTop: 12 }}>
            Изменения вступают в силу при следующем запуске игры.
          </p>
        </>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════
// APP ICON SECTION
// ═══════════════════════════════════════════════════════
function AppIconSection({ config, updateConfig }: { config: GromConfig; updateConfig: (key: keyof GromConfig, value: any) => void }) {
  const [previews, setPreviews] = useState<Record<string, string>>({});
  const [customPreview, setCustomPreview] = useState<string | null>(null);

  const loadPreviews = async () => {
    const list = await window.grom.icon.list();
    const result: Record<string, string> = {};
    for (const key of Object.keys(list)) {
      const data = await window.grom.icon.getBuiltinPreview(key);
      if (data) result[key] = data;
    }
    setPreviews(result);
    const custom = await window.grom.icon.getCustomPreview();
    setCustomPreview(custom);
  };

  useEffect(() => { loadPreviews(); }, []);

  const handleSetBuiltin = async (key: string) => {
    const res = await window.grom.icon.set(key);
    if (res.success) {
      updateConfig('appIcon', key);
      toast('Иконка изменена');
    } else {
      toast('Ошибка: ' + res.error);
    }
  };

  const handleUpload = async () => {
    const res = await window.grom.icon.setCustom();
    if (res.success) {
      updateConfig('appIcon', 'custom');
      const preview = await window.grom.icon.getCustomPreview();
      setCustomPreview(preview);
      toast('Иконка загружена');
    } else {
      toast('Ошибка: ' + res.error);
    }
  };

  const handleReset = async () => {
    const res = await window.grom.icon.reset();
    if (res.success) {
      updateConfig('appIcon', '');
      setCustomPreview(null);
      toast('Иконка сброшена');
    }
  };

  return (
    <div className="settings-section">
      <h2>Иконка приложения</h2>

      <div className="app-icon-grid">
        {['forest', 'grom', 'midnight'].map((key) => {
          const isActive = config.appIcon === key;
          const src = previews[key];
          if (!src) return null;
          return (
            <div
              key={key}
              className={`app-icon-card ${isActive ? 'active' : ''}`}
              onClick={() => handleSetBuiltin(key)}
              title="Применить"
            >
              <img src={src} alt="" />
            </div>
          );
        })}

        {customPreview && (
          <div
            className={`app-icon-card app-icon-custom ${config.appIcon === 'custom' ? 'active' : ''}`}
            onClick={() => handleSetBuiltin('custom')}
            title="Своя иконка"
          >
            <img src={customPreview} alt="" />
          </div>
        )}
      </div>

      <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
        <button className="small-button" onClick={handleUpload}>
          Загрузить свою
        </button>
        {config.appIcon && (
          <button className="small-button" onClick={handleReset}>
            Сбросить
          </button>
        )}
      </div>

      <p className="hint" style={{ marginTop: 10 }}>
        Иконка меняется сразу — посмотри в панели задач
      </p>
    </div>
  );
}
