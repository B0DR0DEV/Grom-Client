import { useEffect, useState } from 'react';

interface CloudItem {
  name: string;
  dataUrl: string;
}

export default function PixelClouds() {
  const [clouds, setClouds] = useState<CloudItem[]>([]);

  useEffect(() => {
    (async () => {
      const list = await window.grom.listClouds();
      setClouds(list);
    })();
  }, []);

  if (clouds.length === 0) return null;

  const positions = [
    { top: '15%', delay: '0s', duration: '45s', size: 220 },
    { top: '45%', delay: '-15s', duration: '60s', size: 180 },
    { top: '70%', delay: '-30s', duration: '50s', size: 200 },
  ];

  return (
    <div className="pixel-clouds">
      {clouds.slice(0, 3).map((cloud, i) => {
        const pos = positions[i] || positions[0];
        return (
          <img
            key={cloud.name}
            src={cloud.dataUrl}
            alt=""
            className="pixel-cloud"
            style={{
              top: pos.top,
              width: pos.size,
              animationDuration: pos.duration,
              animationDelay: pos.delay,
            }}
          />
        );
      })}
    </div>
  );
}