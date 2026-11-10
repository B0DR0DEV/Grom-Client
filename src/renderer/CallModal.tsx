import { useEffect, useRef, useState } from 'react';
import { supabase } from './supabaseClient';
import { ICE_SERVERS, hasTurn, sendToInbox, startRingtone } from './callSignal';

interface CallModalProps {
  nickname: string;
  myAvatar?: string | null;
  peer: { nickname: string; avatar: string | null };
  /** caller rings the peer; callee has accepted an incoming ring */
  role: 'caller' | 'callee';
  room: string;
  onClose: () => void;
}

type Phase = 'mic' | 'ringing' | 'connecting' | 'active' | 'ended';
const RING_TIMEOUT_MS = 40_000;

export default function CallModal({ nickname, myAvatar, peer, role, room, onClose }: CallModalProps) {
  const [phase, setPhase] = useState<Phase>('mic');
  const [status, setStatus] = useState('Подключаем микрофон…');
  const [muted, setMuted] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const channelRef = useRef<any>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const pendingIce = useRef<RTCIceCandidateInit[]>([]);
  const offered = useRef(false);
  const finished = useRef(false);
  const stopTone = useRef<() => void>(() => {});
  const phaseRef = useRef<Phase>('mic');
  phaseRef.current = phase;

  const finish = (message: string, notifyPeer: boolean, delay = 1600) => {
    if (finished.current) return;
    finished.current = true;
    stopTone.current();
    if (notifyPeer) {
      channelRef.current?.send({ type: 'broadcast', event: 'end', payload: { from: nickname } }).catch(() => {});
      if (role === 'caller' && phaseRef.current === 'ringing') sendToInbox(peer.nickname, 'cancel', { room }).catch(() => {});
    }
    streamRef.current?.getTracks().forEach((t) => t.stop());
    pcRef.current?.close();
    pcRef.current = null;
    setPhase('ended'); setStatus(message);
    setTimeout(onClose, delay);
  };

  const flushIce = async () => {
    const pc = pcRef.current; if (!pc?.remoteDescription) return;
    const list = pendingIce.current.splice(0);
    for (const c of list) { try { await pc.addIceCandidate(c); } catch {} }
  };

  const initPeer = async () => {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false });
    streamRef.current = stream;
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    stream.getTracks().forEach((track) => pc.addTrack(track, stream));
    pc.onicecandidate = (e) => {
      if (e.candidate) channelRef.current?.send({ type: 'broadcast', event: 'ice', payload: { candidate: e.candidate.toJSON(), from: nickname } });
    };
    pc.ontrack = (e) => {
      if (audioRef.current) { audioRef.current.srcObject = e.streams[0]; audioRef.current.play().catch(() => {}); }
    };
    pc.onconnectionstatechange = () => {
      const s = pc.connectionState;
      if (s === 'connected') { stopTone.current(); setPhase('active'); setStatus('В звонке'); }
      else if (s === 'disconnected') setStatus('Связь прерывается…');
      else if (s === 'failed') finish(hasTurn ? 'Соединение потеряно' : 'Не удалось соединиться напрямую. Нужен TURN-сервер — см. relay/install-turn.sh', false, 4000);
    };
    pcRef.current = pc;
  };

  useEffect(() => {
    let ringTimer: ReturnType<typeof setTimeout> | null = null;
    const channel = supabase.channel(`call:${room}`, { config: { broadcast: { self: false } } });
    channelRef.current = channel;

    channel
      .on('broadcast', { event: 'ready' }, async () => {
        if (role !== 'caller' || offered.current || !pcRef.current) return;
        offered.current = true;
        if (ringTimer) clearTimeout(ringTimer);
        stopTone.current();
        setPhase('connecting'); setStatus('Соединяем…');
        const offer = await pcRef.current.createOffer();
        await pcRef.current.setLocalDescription(offer);
        await channel.send({ type: 'broadcast', event: 'offer', payload: { sdp: offer, from: nickname } });
      })
      .on('broadcast', { event: 'offer' }, async (m: any) => {
        if (role !== 'callee' || !pcRef.current) return;
        const pc = pcRef.current;
        await pc.setRemoteDescription(new RTCSessionDescription(m.payload.sdp));
        await flushIce();
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        await channel.send({ type: 'broadcast', event: 'answer', payload: { sdp: answer, from: nickname } });
      })
      .on('broadcast', { event: 'answer' }, async (m: any) => {
        const pc = pcRef.current;
        if (role !== 'caller' || !pc || pc.signalingState !== 'have-local-offer') return;
        await pc.setRemoteDescription(new RTCSessionDescription(m.payload.sdp));
        await flushIce();
      })
      .on('broadcast', { event: 'ice' }, async (m: any) => {
        const c = m.payload?.candidate; if (!c) return;
        if (pcRef.current?.remoteDescription) { try { await pcRef.current.addIceCandidate(c); } catch {} }
        else pendingIce.current.push(c);
      })
      .on('broadcast', { event: 'end' }, () => finish('Собеседник завершил звонок', false))
      .subscribe(async (s: string) => {
        if (s === 'CHANNEL_ERROR' || s === 'TIMED_OUT') { finish('Нет связи с сервером звонков', false, 3000); return; }
        if (s !== 'SUBSCRIBED' || pcRef.current || finished.current) return;
        try { await initPeer(); }
        catch { finish('Нет доступа к микрофону. Проверь, что микрофон подключён и разрешён в Windows (Параметры → Конфиденциальность → Микрофон).', false, 5000); return; }
        if (role === 'caller') {
          setPhase('ringing'); setStatus(`Звоним ${peer.nickname}…`);
          stopTone.current = startRingtone('outgoing');
          try { await sendToInbox(peer.nickname, 'ring', { room, from: nickname, avatar: myAvatar || null, at: Date.now() }); }
          catch (e: any) { finish(e?.message || 'Не удалось позвонить', false, 3000); return; }
          ringTimer = setTimeout(() => finish(`${peer.nickname} не отвечает`, true, 2500), RING_TIMEOUT_MS);
        } else {
          setPhase('connecting'); setStatus('Соединяем…');
          await channel.send({ type: 'broadcast', event: 'ready', payload: { from: nickname } });
        }
      });

    // Decline / busy arrive through my inbox; App re-dispatches them as a DOM event.
    const onSignal = (e: Event) => {
      const d = (e as CustomEvent).detail as { type: string; room: string };
      if (d.room !== room) return;
      if (d.type === 'decline') finish(`${peer.nickname} отклонил звонок`, false, 2500);
      if (d.type === 'busy') finish(`${peer.nickname} сейчас в другом звонке`, false, 2500);
    };
    window.addEventListener('grom-call-signal', onSignal);

    return () => {
      if (ringTimer) clearTimeout(ringTimer);
      window.removeEventListener('grom-call-signal', onSignal);
      stopTone.current();
      streamRef.current?.getTracks().forEach((t) => t.stop());
      pcRef.current?.close();
      supabase.removeChannel(channel);
    };
  }, [room]);

  useEffect(() => {
    if (phase !== 'active') return;
    const t = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [phase]);

  const toggleMute = () => {
    const next = !muted;
    streamRef.current?.getAudioTracks().forEach((t) => { t.enabled = !next; });
    setMuted(next);
  };

  const mm = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
  return (
    <div className="call-modal-overlay">
      <div className="call-modal call-card">
        <div className="call-avatar">{peer.avatar ? <img src={peer.avatar} alt="" /> : peer.nickname[0]?.toUpperCase()}</div>
        <h2>{peer.nickname}</h2>
        <p className="hint">{phase === 'active' ? `В звонке · ${mm}` : status}</p>
        <audio ref={audioRef} autoPlay />
        <div className="call-buttons">
          {phase === 'active' && <button className="small-button" onClick={toggleMute}>{muted ? 'Включить микрофон' : 'Выключить микрофон'}</button>}
          {phase !== 'ended' && <button className="small-button call-hangup" onClick={() => finish('Звонок завершён', true, 600)}>{phase === 'ringing' ? 'Отменить' : 'Завершить'}</button>}
        </div>
      </div>
    </div>
  );
}
