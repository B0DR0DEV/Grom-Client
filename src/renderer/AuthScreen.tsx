import { useState } from 'react';
import { register, login } from './auth';
import BrandIcon from './BrandIcon';

interface AuthScreenProps {
  onAuth: (nickname: string, accountType?: 'offline' | 'microsoft') => void;
  appIcon?: string;
  theme?: string;
}

export default function AuthScreen({ onAuth, appIcon, theme }: AuthScreenProps) {
  const [isSignUp, setIsSignUp] = useState(false);
  const [nickname, setNickname] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [msLoading, setMsLoading] = useState(false);

  const handleAvatarPick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) { setError('Выбери файл изображения'); return; }
    if (file.size > 5 * 1024 * 1024) { setError('Аватар должен быть меньше 5 МБ'); return; }
    setAvatarFile(file);
    setAvatarPreview(URL.createObjectURL(file));
    setError('');
  };

  const handleSubmit = async () => {
    const cleanNickname = nickname.trim();
    if (!cleanNickname || !password) { setError('Введи ник и пароль'); return; }
    if (cleanNickname.length < 3 || cleanNickname.length > 16) { setError('Ник: от 3 до 16 символов'); return; }
    if (!/^[a-zA-Z0-9_]+$/.test(cleanNickname)) { setError('Используй латинские буквы, цифры и _'); return; }
    if (isSignUp && password.length < 6) { setError('Пароль должен содержать минимум 6 символов'); return; }
    if (!isSignUp && password.length < 4) { setError('Пароль должен содержать минимум 4 символа'); return; }

    setLoading(true);
    setError('');
    try {
      const res = isSignUp
        ? await register(cleanNickname, password, avatarFile)
        : await login(cleanNickname, password);
      if (!res.success) { setError(res.error || (isSignUp ? 'Ошибка регистрации' : 'Ошибка входа')); return; }
      localStorage.setItem('grom-login', cleanNickname);
      localStorage.setItem('grom-account-type', 'offline');
      onAuth(cleanNickname, 'offline');
    } catch (err: any) {
      setError(err?.message || 'Произошла ошибка. Попробуй ещё раз.');
    } finally {
      setLoading(false);
    }
  };

  const handleMicrosoftLogin = () => {
    setError('Вход через Microsoft — в разработке.');
  };

  const switchMode = () => {
    setIsSignUp((value) => !value);
    setError('');
    setAvatarFile(null);
    setAvatarPreview(null);
  };

  return (
    <div className="auth-screen">
      <div className="auth-bg-clouds" aria-hidden="true"><div className="auth-cloud c1" /><div className="auth-cloud c2" /><div className="auth-cloud c3" /></div>
      <main className="auth-card auth-card-compact">
        <BrandIcon iconKey={appIcon} theme={theme} className="auth-logo-big auth-brand-icon" />
        <h1 className="auth-title">GROM</h1>
        <p className="auth-subtitle">{isSignUp ? 'Создай аккаунт' : 'С возвращением!'}</p>

        {error && <div className="auth-error" role="alert">{error}</div>}

        {isSignUp && (
          <div className="auth-avatar-section">
            <label className="auth-avatar-btn">
              <span className="auth-avatar-preview auth-avatar-preview-compact">{avatarPreview ? <img src={avatarPreview} alt="Предпросмотр аватара" /> : <span>＋</span>}</span>
              <span className="auth-avatar-hint">{avatarPreview ? 'Сменить аватар' : 'Добавить аватар (необязательно)'}</span>
              <input type="file" accept="image/*" onChange={handleAvatarPick} />
            </label>
          </div>
        )}

        <div className="form-group auth-compact-field">
          <label htmlFor="grom-nickname">Ник</label>
          <input id="grom-nickname" type="text" value={nickname} onChange={(e) => setNickname(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && handleSubmit()} placeholder="B0DR0DEV" maxLength={16} autoComplete="username" autoFocus />
        </div>
        <div className="form-group auth-compact-field">
          <label htmlFor="grom-password">Пароль</label>
          <div className="auth-compact-password">
            <input id="grom-password" type={showPassword ? 'text' : 'password'} value={password} onChange={(e) => setPassword(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && handleSubmit()} placeholder="••••••••" autoComplete={isSignUp ? 'new-password' : 'current-password'} />
            <button type="button" className="auth-password-plain-toggle" onClick={() => setShowPassword((value) => !value)}>{showPassword ? 'Скрыть' : 'Показать'}</button>
          </div>
          {isSignUp && <small className="auth-password-hint">Не используй пароль от других сайтов.</small>}
        </div>

        <button className="play-button auth-submit" onClick={handleSubmit} disabled={loading || msLoading}>
          {loading ? '⏳ Подождите…' : isSignUp ? 'Создать аккаунт' : 'Войти'}
        </button>
        <button className="auth-switch" onClick={switchMode}>{isSignUp ? '← Уже есть аккаунт? Войти' : 'Нет аккаунта? Создать →'}</button>

        <div className="auth-divider"><span>ИЛИ</span></div>
        <button className="microsoft-login-button" onClick={handleMicrosoftLogin} disabled={msLoading || loading}>
          <span className="microsoft-mark" aria-hidden="true"><i /><i /><i /><i /></span>
          <span>Вход через Microsoft — в разработке</span>
        </button>
        <p className="auth-microsoft-note">Подключение Microsoft временно недоступно.</p>
      </main>
    </div>
  );
}
