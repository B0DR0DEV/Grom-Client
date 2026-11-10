import { useState, useEffect } from 'react';

interface PetProps {
  enabled: boolean;
  petType: string;
}

export default function Pet({ enabled, petType }: PetProps) {
  const [frames, setFrames] = useState<string[]>([]);
  const [currentFrame, setCurrentFrame] = useState(0);

  useEffect(() => {
    if (!enabled) return;
    (async () => {
      const f = await window.grom.getPetFrames(petType);
      setFrames(f);
    })();
  }, [enabled, petType]);

  useEffect(() => {
    if (frames.length === 0) return;
    const interval = setInterval(() => {
      setCurrentFrame((c) => (c + 1) % frames.length);
    }, 250);
    return () => clearInterval(interval);
  }, [frames]);

  if (!enabled || frames.length === 0) return null;

  return (
    <div className="pet-container">
      <img src={frames[currentFrame]} alt="" className="pet-sprite" />
    </div>
  );
}