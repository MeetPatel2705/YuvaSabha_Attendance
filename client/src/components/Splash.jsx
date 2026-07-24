import { useEffect, useState } from 'react';

const FADE_AT_MS = 2000;
const REMOVE_AT_MS = 2600;

const PARTICLES = [
  { left: '18%', delay: '0s', duration: '2.6s', size: 5 },
  { left: '30%', delay: '0.5s', duration: '3.1s', size: 4 },
  { left: '42%', delay: '0.2s', duration: '2.4s', size: 6 },
  { left: '55%', delay: '0.8s', duration: '2.9s', size: 4 },
  { left: '66%', delay: '0.35s', duration: '2.5s', size: 5 },
  { left: '78%', delay: '0.65s', duration: '3.3s', size: 4 },
  { left: '24%', delay: '1.1s', duration: '2.7s', size: 3 },
  { left: '72%', delay: '1.3s', duration: '2.6s', size: 3 },
];

export default function Splash() {
  const [phase, setPhase] = useState('visible'); // visible | hiding | gone

  useEffect(() => {
    const fadeTimer = setTimeout(() => setPhase('hiding'), FADE_AT_MS);
    const removeTimer = setTimeout(() => setPhase('gone'), REMOVE_AT_MS);
    return () => {
      clearTimeout(fadeTimer);
      clearTimeout(removeTimer);
    };
  }, []);

  if (phase === 'gone') return null;

  return (
    <div className={`splash${phase === 'hiding' ? ' splash-hide' : ''}`} aria-hidden="true">
      <div className="splash-particles">
        {PARTICLES.map((p, i) => (
          <span
            key={i}
            style={{
              left: p.left,
              width: p.size,
              height: p.size,
              animationDelay: p.delay,
              animationDuration: p.duration,
            }}
          />
        ))}
      </div>

      <div className="splash-center">
        <div className="splash-halo" />
        <div className="splash-ring" />
        <img src="/logo.png" alt="" className="splash-logo" />
      </div>

      <p className="splash-greeting">Jay Shree Swaminarayan</p>
      <p className="splash-sub">Yuva Sabha · Harinagar Mandir</p>
    </div>
  );
}
