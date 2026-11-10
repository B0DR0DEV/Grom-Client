import { useState, useEffect } from 'react';
import { supabase } from './supabaseClient';

interface ProfilePageProps {
  nickname: string;
  onNicknameChange: (nick: string) => void;
}

export default function ProfilePage({ nickname, onNicknameChange }: ProfilePageProps) {
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [status, setStatus] = useState('online');
  const [newNick, setNewNick] = useState(nickname);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from('profiles')
        .select('*')
        .eq('nickname', nickname)
        .single();

      if (data) {
        setAvatarUrl(data.avatar_url);
        setStatus(data.status || 'online');
      }
    })();
  }, [nickname]);

  const handleAvatarUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const fileName = `avatars/${nickname}-${Date.now()}.png`;
    const { error } = await supabase.storage.from('chat-files').upload(fileName, file);
    if (error) return alert('Ошибка: ' + error.message);

    const { data: urlData } = supabase.storage.from('chat-files').getPublicUrl(fileName);
    setAvatarUrl(urlData.publicUrl);

    await supabase.from('profiles').upsert({
      nickname,
      avatar_url: urlData.publicUrl,
      status,
    });
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      if (newNick !== nickname) {
        await supabase.from('profiles').update({ nickname: newNick }).eq('nickname', nickname);
        onNicknameChange(newNick);
      }
      await supabase.from('profiles').upsert({
        nickname: newNick,
        avatar_url: avatarUrl,
        status,
      });
      alert('Профиль сохранён!');
    } catch (err: any) {
      alert('Ошибка: ' + err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="profile-page">
      <h1>👤 Обо мне</h1>

      <div className="profile-card">
        <div className="profile-avatar-section">
          <div className="profile-avatar">
            {avatarUrl ? (
              <img src={avatarUrl} alt="Avatar" />
            ) : (
              <span className="avatar-placeholder">{nickname[0]?.toUpperCase() || '?'}</span>
            )}
          </div>
          <label className="small-button" style={{ cursor: 'pointer' }}>
            📷 Загрузить аву
            <input type="file" accept="image/*" onChange={handleAvatarUpload} style={{ display: 'none' }} />
          </label>
        </div>

        <div className="profile-fields">
          <div className="form-group">
            <label>Никнейм</label>
            <input type="text" value={newNick} onChange={(e) => setNewNick(e.target.value)} maxLength={16} />
          </div>

          <div className="form-group">
            <label>Статус</label>
            <select value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="online">🟢 Онлайн</option>
              <option value="away">🟡 Отошёл</option>
              <option value="busy">🔴 Занят</option>
              <option value="playing">🎮 Играю</option>
            </select>
          </div>

          <button className="play-button" onClick={handleSave} disabled={saving}>
            {saving ? '⏳ Сохранение...' : '💾 Сохранить'}
          </button>
        </div>
      </div>
    </div>
  );
}