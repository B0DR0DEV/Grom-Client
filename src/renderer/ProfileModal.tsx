import { useState, useEffect } from 'react';
import { logout } from './auth';
import { supabase } from './supabaseClient';
import { toast } from './Toast';

interface ProfileModalProps {
  nickname: string;
  accountType?: 'offline' | 'microsoft';
  onClose: () => void;
  onNicknameChange?: (nick: string) => void;
  onAccountChange?: (nick: string, accountType: 'offline' | 'microsoft') => void;
  targetNickname?: string | null;
  onStartChat?: (nickname: string) => void;
}

export default function ProfileModal({
  nickname,
  accountType = 'offline',
  onClose,
  onNicknameChange,
  onAccountChange,
  targetNickname,
  onStartChat,
}: ProfileModalProps) {
  const isOwnProfile = !targetNickname || targetNickname === nickname;
  const profileNick = isOwnProfile ? nickname : targetNickname!;

  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [status, setStatus] = useState('online');
  const [newNick, setNewNick] = useState(nickname);
  const [saving, setSaving] = useState(false);
  const [microsoftLoading, setMicrosoftLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase
        .from('accounts')
        .select('avatar_url, status')
        .eq('nickname', profileNick)
        .maybeSingle();
      if (!cancelled && !error && data) {
        setAvatarUrl(data.avatar_url || null);
        setStatus(data.status || 'offline');
      }
    })();
    return () => { cancelled = true; };
  }, [profileNick]);

  const handleAvatarUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) { toast('Выбери файл изображения'); e.target.value = ''; return; }
    if (file.size > 5 * 1024 * 1024) { toast('Аватар должен быть меньше 5 МБ'); e.target.value = ''; return; }
    const extension = (file.name.split('.').pop() || 'png').toLowerCase().replace(/[^a-z0-9]/g, '') || 'png';
    const fileName = `avatars/${nickname}-${Date.now()}.${extension}`;
    try {
      const { error } = await supabase.storage.from('chat-files').upload(fileName, file);
      if (error) throw error;
      const { data: urlData } = supabase.storage.from('chat-files').getPublicUrl(fileName);
      const { error: updateError } = await supabase.from('accounts').update({ avatar_url: urlData.publicUrl }).eq('nickname', nickname);
      if (updateError) throw updateError;
      setAvatarUrl(urlData.publicUrl);
      toast('Аватар обновлён');
    } catch (err: any) {
      toast('Не удалось загрузить аватар: ' + (err?.message || 'неизвестная ошибка'));
    } finally {
      e.target.value = '';
    }
  };

  const handleSave = async () => {
    const cleanNick = newNick.trim();
    if (cleanNick.length < 3 || cleanNick.length > 16 || !/^[a-zA-Z0-9_]+$/.test(cleanNick)) {
      toast('Ник: 3–16 символов, латиница, цифры и _');
      return;
    }
    setSaving(true);
    try {
      const { error } = await supabase.from('accounts').update({ nickname: cleanNick, status }).eq('nickname', nickname);
      if (error) throw error;
      localStorage.setItem('grom-login', cleanNick);
      if (onNicknameChange && cleanNick !== nickname) onNicknameChange(cleanNick);
      toast('Профиль сохранён');
      onClose();
    } catch (err: any) {
      toast('Ошибка: ' + (err?.message || 'не удалось сохранить профиль'));
    } finally {
      setSaving(false);
    }
  };

  const handleMicrosoftLogin = () => {
    toast('Вход через Microsoft — в разработке.');
  };

  const handleLogout = async () => {
    try {
      if (accountType === 'microsoft') await window.grom.microsoftLogout();
    } finally {
      void logout();
      localStorage.removeItem('grom-login');
      localStorage.removeItem('grom-account-type');
      window.location.reload();
    }
  };

  const handleStartChat = () => {
    if (!targetNickname || !onStartChat) return;
    onStartChat(targetNickname);
    onClose();
  };

  const statusLabel = status === 'online' ? 'В сети' : status === 'away' ? 'Отошёл' : status === 'busy' ? 'Занят' : status === 'playing' ? 'Играет' : 'Не в сети';

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-box profile-modal profile-modal-compact" onClick={(e) => e.stopPropagation()}>
        <div className="profile-compact-header">
          <h3>{isOwnProfile ? 'Профиль' : profileNick}</h3>
          <button type="button" className="profile-compact-close" onClick={onClose} aria-label="Закрыть">×</button>
        </div>

        <div className="profile-compact-user">
          <div className="profile-avatar profile-compact-avatar">
            {avatarUrl ? <img src={avatarUrl} alt={`Аватар ${profileNick}`} /> : <span>{profileNick[0]?.toUpperCase() || 'G'}</span>}
          </div>
          <div className="profile-compact-user-info">
            <strong>{profileNick}</strong>
            <span className={`profile-compact-status ${status === 'online' ? 'online' : ''}`}><i /> {isOwnProfile ? (accountType === 'microsoft' ? 'Аккаунт Microsoft' : 'Аккаунт Grom') : statusLabel}</span>
            {isOwnProfile && <label className="small-button profile-compact-upload">📷 {avatarUrl ? 'Сменить аватар' : 'Добавить аватар'}<input type="file" accept="image/*" onChange={handleAvatarUpload} /></label>}
          </div>
        </div>

        {isOwnProfile ? accountType === 'microsoft' ? (
          <>
            <div className="form-group"><label>Ник Minecraft</label><input type="text" value={nickname} readOnly /></div>
            <p className="hint profile-compact-hint">Ник берётся из официального профиля Minecraft. Чтобы сменить аккаунт, выйди и войди снова.</p>
            <div className="modal-buttons"><button className="small-button" onClick={handleLogout}>Выйти из Microsoft</button><button className="play-button" onClick={onClose}>Закрыть</button></div>
          </>
        ) : (
          <>
            <div className="form-group"><label htmlFor="profile-nickname-compact">Ник</label><input id="profile-nickname-compact" type="text" value={newNick} onChange={(e) => setNewNick(e.target.value)} maxLength={16} /></div>
            <div className="form-group"><label htmlFor="profile-status-compact">Статус</label><select id="profile-status-compact" value={status} onChange={(e) => setStatus(e.target.value)}><option value="online">В сети</option><option value="away">Отошёл</option><option value="busy">Занят</option><option value="playing">Играю</option></select></div>
            <p className="hint profile-compact-hint">Подключение Microsoft временно недоступно и появится в одном из следующих обновлений.</p>
            <button className="small-button" onClick={handleMicrosoftLogin} disabled={microsoftLoading}>Вход через Microsoft — в разработке</button>
            <div className="modal-buttons"><button className="small-button" onClick={handleLogout}>Выйти</button><button className="play-button" onClick={handleSave} disabled={saving}>{saving ? 'Сохраняем…' : 'Сохранить'}</button></div>
          </>
        ) : (
          <>
            <p className="hint profile-compact-hint">Игрок Grom · {statusLabel}</p>
            <div className="modal-buttons"><button className="small-button" onClick={onClose}>Закрыть</button><button className="play-button" onClick={handleStartChat}>💬 Написать</button></div>
          </>
        )}
      </div>
    </div>
  );
}
