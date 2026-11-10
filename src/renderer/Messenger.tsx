import { useState, useEffect, useRef } from 'react';
import { supabase } from './supabaseClient';
import { toast } from './Toast';

interface Message {
  id: string;
  from_nickname: string;
  to_nickname: string;
  text: string | null;
  file_url: string | null;
  file_name: string | null;
  created_at: string;
  reply_to_id: string | null;
  reply_to_text: string | null;
  reply_to_author: string | null;
  edited: boolean;
  _optimistic?: boolean;
}

interface ChatUser {
  nickname: string;
  avatar_url: string | null;
  status: string;
  lastMessage?: string;
}

async function fetchMessagesForChat(nickname: string, activeChat: string): Promise<Message[]> {
  let query: any;
  if (activeChat === 'general') {
    query = supabase.from('direct_messages').select('*')
      .eq('to_nickname', 'general').order('created_at', { ascending: true });
  } else {
    query = supabase.from('direct_messages').select('*')
      .or(`and(from_nickname.eq.${nickname},to_nickname.eq.${activeChat}),and(from_nickname.eq.${activeChat},to_nickname.eq.${nickname})`)
      .order('created_at', { ascending: true });
  }
  const { data, error } = await query;
  if (error) throw error;
  return (data || []) as Message[];
}

function mergeMessages(existing: Message[], incoming: Message[]): Message[] {
  const byId = new Map<string, Message>();
  for (const message of incoming) byId.set(message.id, message);
  // Keep messages still being inserted while the periodic/reconnect sync is running.
  for (const message of existing) if (message._optimistic && !byId.has(message.id)) byId.set(message.id, message);
  return Array.from(byId.values()).sort((a, b) => a.created_at.localeCompare(b.created_at));
}

interface MessengerProps {
  nickname: string;
  initialChat?: string | null;
  onInitialChatHandled?: () => void;
  onCall: (targetNickname: string, avatar: string | null) => void;
  onOpenProfile: (nickname: string) => void;
}

export default function Messenger({ nickname, initialChat, onInitialChatHandled, onCall, onOpenProfile }: MessengerProps) {
  const [chats, setChats] = useState<ChatUser[]>([]);
  const [activeChat, setActiveChat] = useState<string>('general');
  const [messages, setMessages] = useState<Message[]>([]);
  const [messagesLoading, setMessagesLoading] = useState(true);
  const [messagesError, setMessagesError] = useState(false);
  const [realtimeConnected, setRealtimeConnected] = useState(false);
  const [reloadHistoryKey, setReloadHistoryKey] = useState(0);
  const historyRequestRef = useRef(0);
  const [input, setInput] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<ChatUser[]>([]);
  const [showSearch, setShowSearch] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [replyTo, setReplyTo] = useState<Message | null>(null);
  const [editingMsg, setEditingMsg] = useState<Message | null>(null);
  const [menuMsgId, setMenuMsgId] = useState<string | null>(null);
  const [avatars, setAvatars] = useState<Record<string, string | null>>({});
  const messagesListRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    (async () => {
      await supabase.from('accounts').upsert({ nickname, status: 'online' }, { onConflict: 'nickname' });
    })();
  }, [nickname]);

  // Загружаем все аватарки
  const loadAvatars = async (nicks: string[]) => {
    const unique = Array.from(new Set(nicks)).filter((n) => n && n !== 'general');
    if (unique.length === 0) return;
    const { data } = await supabase.from('accounts').select('nickname, avatar_url').in('nickname', unique);
    const map: Record<string, string | null> = {};
    for (const row of data || []) {
      map[row.nickname] = row.avatar_url;
    }
    setAvatars((prev) => ({ ...prev, ...map }));
  };

  const loadChats = async () => {
    const { data } = await supabase
      .from('direct_messages')
      .select('*')
      .or(`from_nickname.eq.${nickname},to_nickname.eq.${nickname}`)
      .order('created_at', { ascending: false });

    if (!data) return;
    const userSet = new Map<string, ChatUser>();
    const allNicks: string[] = [];

    for (const msg of data) {
      const other = msg.from_nickname === nickname ? msg.to_nickname : msg.from_nickname;
      if (other === 'general') continue;
      if (!userSet.has(other)) {
        allNicks.push(other);
        userSet.set(other, {
          nickname: other,
          avatar_url: null,
          status: 'offline',
          lastMessage: msg.text || (msg.file_name ? `📎 ${msg.file_name}` : ''),
        });
      }
    }

    if (allNicks.length > 0) {
      const { data: profiles } = await supabase.from('accounts').select('*').in('nickname', allNicks);
      for (const p of profiles || []) {
        const existing = userSet.get(p.nickname);
        if (existing) {
          existing.avatar_url = p.avatar_url;
          existing.status = p.status || 'offline';
        }
      }
    }

    setChats(Array.from(userSet.values()));
  };

  useEffect(() => { loadChats(); }, [nickname]);

  // Переход к личному чату из окна профиля.
  useEffect(() => {
    if (!initialChat || initialChat === nickname) return;
    setActiveChat(initialChat);
    (async () => {
      const { data } = await supabase.from('accounts').select('nickname, avatar_url, status').eq('nickname', initialChat).maybeSingle();
      const chatUser: ChatUser = {
        nickname: initialChat,
        avatar_url: data?.avatar_url || null,
        status: data?.status || 'offline',
      };
      setChats((prev) => prev.some((entry) => entry.nickname === initialChat) ? prev : [chatUser, ...prev]);
      if (chatUser.avatar_url) setAvatars((prev) => ({ ...prev, [initialChat]: chatUser.avatar_url }));
    })();
    onInitialChatHandled?.();
  }, [initialChat, nickname, onInitialChatHandled]);

  // Realtime — INSERT, UPDATE, DELETE, with an explicit connection state.
  useEffect(() => {
    let alive = true;
    setRealtimeConnected(false);
    const channel = supabase
      .channel('dm-channel')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'direct_messages' }, (payload) => {
        const { eventType, new: newRow, old: oldRow } = payload as any;
        const msg = newRow as Message;
        if (msg) {
          const isRelevant =
            (msg.from_nickname === nickname && msg.to_nickname === activeChat) ||
            (msg.to_nickname === nickname && msg.from_nickname === activeChat) ||
            (activeChat === 'general' && msg.to_nickname === 'general');

          if (isRelevant) {
            setMessages((prev) => {
              const idx = prev.findIndex((m) => m.id === msg.id);
              if (idx >= 0) {
                const copy = [...prev];
                copy[idx] = { ...msg, _optimistic: false };
                return copy;
              }
              return [...prev, msg].sort((a, b) => a.created_at.localeCompare(b.created_at));
            });
            loadAvatars([msg.from_nickname]);
          }
        }

        if (eventType === 'DELETE' && oldRow?.id) {
          setMessages((prev) => prev.filter((m) => m.id !== oldRow.id));
        }
        void loadChats();
      })
      .subscribe((status) => {
        if (!alive) return;
        const isConnected = status === 'SUBSCRIBED';
        setRealtimeConnected(isConnected);
        if (isConnected) {
          // Fetch again on reconnect so messages sent during a disconnect are not missed.
          void fetchMessagesForChat(nickname, activeChat).then((data) => {
            if (alive) {
              setMessages((prev) => mergeMessages(prev, data));
              setMessagesError(false);
              setMessagesLoading(false);
            }
          }).catch(() => { if (alive) setRealtimeConnected(false); });
        }
      });

    return () => { alive = false; supabase.removeChannel(channel); };
  }, [nickname, activeChat]);

  // Load history and poll as a fallback if Realtime is slow or temporarily disconnected.
  useEffect(() => {
    let alive = true;
    const requestId = ++historyRequestRef.current;
    setMessagesLoading(true);
    setMessagesError(false);
    setMessages([]);

    const sync = async (initial = false) => {
      try {
        const data = await fetchMessagesForChat(nickname, activeChat);
        if (!alive || historyRequestRef.current !== requestId) return;
        setMessages((prev) => mergeMessages(prev, data));
        setMessagesError(false);
        setMessagesLoading(false);
        loadAvatars(data.map((message) => message.from_nickname));
      } catch {
        if (!alive || historyRequestRef.current !== requestId) return;
        if (initial) setMessagesError(true);
        setMessagesLoading(false);
      }
    };

    void sync(true);
    const poll = window.setInterval(() => { void sync(false); }, 4000);
    return () => { alive = false; window.clearInterval(poll); };
  }, [activeChat, nickname, reloadHistoryKey]);

  // Scroll only the message pane. scrollIntoView() also scrolls launcher-content,
  // which made the whole app jump when opening Messenger or receiving a message.
  useEffect(() => {
    const pane = messagesListRef.current;
    if (pane) pane.scrollTo({ top: pane.scrollHeight, behavior: 'smooth' });
  }, [messages]);

  // ПОИСК
  const handleSearch = async () => {
    if (!searchQuery.trim()) return;
    const { data } = await supabase
      .from('accounts')
      .select('*')
      .ilike('nickname', `%${searchQuery}%`)
      .neq('nickname', nickname)
      .limit(20);

    setSearchResults((data || []).map((p: any) => ({
      nickname: p.nickname,
      avatar_url: p.avatar_url,
      status: p.status || 'offline',
    })));
  };

  const startChatWith = (user: ChatUser) => {
    // Открываем чат — если его ещё нет, добавим в список
    setActiveChat(user.nickname);
    setShowSearch(false);
    setSearchQuery('');
    setSearchResults([]);
    setChats((prev) => {
      if (prev.find((c) => c.nickname === user.nickname)) return prev;
      return [user, ...prev];
    });
  };

  // ОТПРАВКА — оптимистично
  const sendMessage = async () => {
    if (!input.trim() || !activeChat) return;

    if (editingMsg) {
      // Редактирование — оптимистично
      const msgId = editingMsg.id;
      const newText = input.trim();
      setMessages((prev) => prev.map((m) => m.id === msgId ? { ...m, text: newText, edited: true } : m));
      setInput('');
      setEditingMsg(null);

      const { error } = await supabase.from('direct_messages').update({ text: newText, edited: true }).eq('id', msgId);
      if (error) toast('Ошибка: ' + error.message);
      return;
    }

    // Новое — оптимистично
    const optimisticId = `optimistic-${Date.now()}`;
    const optimisticMsg: Message = {
      id: optimisticId,
      from_nickname: nickname,
      to_nickname: activeChat,
      text: input.trim(),
      file_url: null,
      file_name: null,
      created_at: new Date().toISOString(),
      reply_to_id: replyTo?.id || null,
      reply_to_text: replyTo?.text || null,
      reply_to_author: replyTo?.from_nickname || null,
      edited: false,
      _optimistic: true,
    };

    setMessages((prev) => [...prev, optimisticMsg]);
    setInput('');
    setReplyTo(null);

    const { data, error } = await supabase.from('direct_messages').insert({
      from_nickname: nickname,
      to_nickname: optimisticMsg.to_nickname,
      text: optimisticMsg.text,
      file_url: null,
      file_name: null,
      reply_to_id: optimisticMsg.reply_to_id,
      reply_to_text: optimisticMsg.reply_to_text,
      reply_to_author: optimisticMsg.reply_to_author,
    }).select().single();

    if (error) {
      toast('Ошибка: ' + error.message);
      setMessages((prev) => prev.filter((m) => m.id !== optimisticId));
    } else if (data) {
      setMessages((prev) => prev.map((m) => m.id === optimisticId ? { ...data, _optimistic: false } : m));
    }
  };

  // УДАЛЕНИЕ — оптимистично
  const deleteMessage = async (msg: Message) => {
    setMessages((prev) => prev.filter((m) => m.id !== msg.id));
    setMenuMsgId(null);

    const { error } = await supabase.from('direct_messages').delete().eq('id', msg.id);
    if (error) toast('Ошибка удаления: ' + error.message);
    else toast('Удалено');
  };

  const startEdit = (msg: Message) => {
    setEditingMsg(msg);
    setInput(msg.text || '');
    setMenuMsgId(null);
  };

  const uploadFile = async (file: File) => {
    if (!activeChat) return;
    setUploading(true);
    try {
      const fileName = `${Date.now()}-${file.name}`;
      const { error } = await supabase.storage.from('chat-files').upload(fileName, file);
      if (error) throw error;
      const { data: urlData } = supabase.storage.from('chat-files').getPublicUrl(fileName);
      await supabase.from('direct_messages').insert({
        from_nickname: nickname, to_nickname: activeChat,
        text: null, file_url: urlData.publicUrl, file_name: file.name,
        reply_to_id: null, reply_to_text: null, reply_to_author: null,
      });
    } catch (err: any) { toast('Ошибка: ' + err.message); }
    finally { setUploading(false); }
  };

  const statusIcon = (s: string) => s === 'online' ? '🟢' : s === 'away' ? '🟡' : s === 'busy' ? '🔴' : s === 'playing' ? '🎮' : '⚫';

  const activeChatData = chats.find((c) => c.nickname === activeChat);

  return (
    <div className="telegram-messenger">
      <aside className="chat-sidebar">
        <div className="chat-sidebar-header">
          <h2>💬 Чаты</h2>
          <button className="small-button" onClick={() => setShowSearch(!showSearch)}>🔍</button>
        </div>

        {showSearch && (
          <div className="chat-search">
            <input type="text" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSearch()} placeholder="Найти по нику..." />
            <div className="search-results">
              {searchResults.map((user) => (
                <div key={user.nickname} className="chat-item" onClick={() => startChatWith(user)}>
                  <div className="chat-avatar">
                    {user.avatar_url ? <img src={user.avatar_url} alt="" /> : <span>{user.nickname[0]?.toUpperCase()}</span>}
                  </div>
                  <div className="chat-info">
                    <div className="chat-name">{statusIcon(user.status)} {user.nickname}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="chat-list">
          <div className={`chat-item ${activeChat === 'general' ? 'active' : ''}`} onClick={() => setActiveChat('general')}>
            <div className="chat-avatar general-avatar">🌍</div>
            <div className="chat-info">
              <div className="chat-name">🌍 General</div>
              <div className="chat-preview">Общий чат</div>
            </div>
          </div>

          {chats.map((chat) => (
            <div key={chat.nickname} className={`chat-item ${activeChat === chat.nickname ? 'active' : ''}`} onClick={() => setActiveChat(chat.nickname)}>
              <div className="chat-avatar">
                {chat.avatar_url ? <img src={chat.avatar_url} alt="" /> : <span>{chat.nickname[0]?.toUpperCase()}</span>}
              </div>
              <div className="chat-info">
                <div className="chat-name">{statusIcon(chat.status)} {chat.nickname}</div>
                {chat.lastMessage && <div className="chat-preview">{chat.lastMessage}</div>}
              </div>
            </div>
          ))}
        </div>
      </aside>

      <main className="chat-main">
        <div className="chat-header">
          <div className="chat-header-user" onClick={() => activeChat !== 'general' && onOpenProfile(activeChat)}>
            <div className={`chat-avatar ${activeChat === 'general' ? 'general-avatar' : ''}`}>
              {activeChat === 'general' ? '🌍' : (activeChatData?.avatar_url
                ? <img src={activeChatData.avatar_url} alt="" />
                : <span>{activeChat[0]?.toUpperCase()}</span>)}
            </div>
            <div>
              <div className="chat-name">{activeChat === 'general' ? '🌍 General' : activeChat}</div>
              <div className="chat-status">
                {activeChat === 'general' ? 'Все пользователи' : statusIcon(activeChatData?.status || 'offline') + ' ' + (activeChatData?.status || 'offline')}
              </div>
              <div className="chat-status chat-sync-status">
                {messagesLoading ? 'Загрузка сообщений…' : realtimeConnected ? 'Синхронизация активна' : 'Обновляем сообщения…'}
              </div>
            </div>
          </div>
          {activeChat !== 'general' && (
            <button className="call-button" title="Позвонить" onClick={() => onCall(activeChat, activeChatData?.avatar_url || null)}>📞</button>
          )}
        </div>

        <div className="messages-list" ref={messagesListRef}>
          {messages.length === 0 && messagesError && <button type="button" className="messages-empty messages-empty-retry" onClick={() => setReloadHistoryKey((n) => n + 1)}>Не удалось загрузить сообщения. Нажми, чтобы повторить.</button>}
          {messages.length === 0 && !messagesError && (messagesLoading || !realtimeConnected) && <div className="messages-empty">{messagesLoading ? 'Загрузка сообщений…' : 'Синхронизация сообщений…'}</div>}
          {messages.length === 0 && !messagesLoading && !messagesError && realtimeConnected && <div className="messages-empty">Сообщений пока нет.</div>}
          {messages.map((msg) => {
            const isOwn = msg.from_nickname === nickname;
            const avatar = avatars[msg.from_nickname];
            return (
              <div key={msg.id} className={`message-wrapper ${isOwn ? 'own-wrapper' : 'other-wrapper'} ${msg._optimistic ? 'optimistic' : ''}`}>
                <div className="msg-avatar" onClick={() => onOpenProfile(msg.from_nickname)}>
                  {avatar ? <img src={avatar} alt="" /> : <span>{msg.from_nickname[0]?.toUpperCase()}</span>}
                </div>

                <div className={`message ${isOwn ? 'own' : 'other'}`} onClick={() => isOwn && setMenuMsgId(menuMsgId === msg.id ? null : msg.id)}>
                  {!isOwn && <div className="message-author">{msg.from_nickname}</div>}
                  {isOwn && activeChat === 'general' && <div className="message-author">Ты</div>}

                  {msg.reply_to_text && (
                    <div className="reply-quote">
                      <strong>{msg.reply_to_author}</strong>
                      <span>{msg.reply_to_text}</span>
                    </div>
                  )}

                  <div className="message-text">
                    {msg.file_url ? <a href={msg.file_url} target="_blank" rel="noopener noreferrer">📎 {msg.file_name}</a> : msg.text}
                    {msg.edited && <span className="edited-mark"> (изменено)</span>}
                  </div>
                  <div className="message-time">
                    {new Date(msg.created_at).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}
                  </div>
                </div>

                <button className="msg-action reply-btn" onClick={() => setReplyTo(msg)} title="Ответить">↩</button>

                {isOwn && menuMsgId === msg.id && (
                  <div className="msg-menu">
                    <button onClick={() => startEdit(msg)}>✏ Изменить</button>
                    <button onClick={() => deleteMessage(msg)}>🗑 Удалить</button>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {replyTo && (
          <div className="reply-bar">
            <div className="reply-bar-content">
              <strong>{replyTo.from_nickname}</strong>
              <span>{replyTo.text || '📎 файл'}</span>
            </div>
            <button className="small-button" onClick={() => setReplyTo(null)}>✕</button>
          </div>
        )}

        {editingMsg && (
          <div className="reply-bar edit-bar">
            <div className="reply-bar-content">
              <strong>✏ Редактирование</strong>
              <span>{editingMsg.text}</span>
            </div>
            <button className="small-button" onClick={() => { setEditingMsg(null); setInput(''); }}>✕</button>
          </div>
        )}

        <div className="messenger-input">
          <input type="text" value={input} onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && sendMessage()}
            placeholder={editingMsg ? 'Изменить...' : 'Написать сообщение...'} />
          <input ref={fileInputRef} type="file" style={{ display: 'none' }}
            onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadFile(f); }} />
          <button className="small-button" onClick={() => fileInputRef.current?.click()} disabled={uploading}>
            {uploading ? '⏳' : '📎'}
          </button>
          <button className="small-button" onClick={sendMessage}>{editingMsg ? '✓' : '➤'}</button>
        </div>
      </main>
    </div>
  );
}