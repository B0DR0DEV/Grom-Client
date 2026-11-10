import { useEffect, useState } from 'react';
import stormBackground from '../../assets/backgrounds/bg-storm.png';
import BrandIcon from './BrandIcon';

export default function Splash({ onDone }: { onDone: () => void }) {
  const [fadeOut, setFadeOut] = useState(false);

  useEffect(() => {
    // Keep the cinematic startup splash visible for 3 seconds in total.
    // Begin the 500 ms CSS fade at 2.5 s so the transition finishes at 3 s.
    const fadeTimer = window.setTimeout(() => setFadeOut(true), 2500);
    const doneTimer = window.setTimeout(onDone, 3000);
    return () => {
      window.clearTimeout(fadeTimer);
      window.clearTimeout(doneTimer);
    };
  }, []);

  return (
    <div
      className={`splash splash-redesigned ${fadeOut ? 'splash-fade-out' : ''}`}
      style={{ backgroundImage: `linear-gradient(115deg, rgba(7, 9, 13, .96), rgba(7, 9, 13, .74)), url("${stormBackground}")` }}
      aria-label="Запуск Grom Client"
      role="status"
    >
      <div className="splash-redesigned-grid" aria-hidden="true" />
      <div className="splash-redesigned-glow" aria-hidden="true" />
      <div className="splash-redesigned-content">
        <div className="splash-redesigned-mark"><BrandIcon className="splash-brand-icon" /></div>
        <div className="splash-redesigned-overline"><span /> DESKTOP GAME ENVIRONMENT</div>
        <h1 className="splash-redesigned-title">GROM<span>CLIENT</span></h1>
        <p className="splash-redesigned-subtitle">ТВОЯ ИГРА. ТВОИ ПРАВИЛА.</p>
        <div className="splash-redesigned-loader"><span /></div>
        <div className="splash-redesigned-foot"><span>ИНИЦИАЛИЗАЦИЯ ИНТЕРФЕЙСА</span><span className="splash-redesigned-pulses"><i /><i /><i /></span></div>
      </div>
      <div className="splash-redesigned-corner splash-redesigned-corner-tl">GC<span>/</span>001</div>
      <div className="splash-redesigned-corner splash-redesigned-corner-br">BUILT FOR YOUR NEXT WORLD</div>
    </div>
  );
}
