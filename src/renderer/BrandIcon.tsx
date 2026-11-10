import { useEffect, useState } from 'react';
import defaultIcon from '../../assets/icons/icon-midnight.png';

type BrandIconProps = {
  iconKey?: string;
  theme?: string;
  className?: string;
  alt?: string;
};

/** Uses the exact icon selected in Settings; falls back to the built-in Grom icon. */
export default function BrandIcon({ iconKey, theme, className, alt = 'Grom Client' }: BrandIconProps) {
  const [src, setSrc] = useState<string>(defaultIcon);

  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        let key = iconKey;
        let currentTheme = theme;
        if (key === undefined || currentTheme === undefined) {
          const config = await window.grom.getConfig();
          if (key === undefined) key = config.appIcon;
          if (currentTheme === undefined) currentTheme = config.theme;
        }
        const preview = await window.grom.icon.getBrandPreview(key || '', currentTheme || 'midnight');
        if (active && preview) setSrc(preview);
      } catch {
        // Keep the local built-in image if config or IPC is temporarily unavailable.
      }
    };
    void load();
    return () => { active = false; };
  }, [iconKey, theme]);

  return <img className={className} src={src} alt={alt} draggable={false} />;
}
