import { useEffect, useRef } from 'react';
import { SkinViewer as SkinViewer3D } from 'skinview3d';

interface SkinViewerProps {
  skinUrl: string | null;
  capeUrl?: string | null;
  width?: number;
  height?: number;
}

export default function SkinViewer({ skinUrl, capeUrl, width = 280, height = 280 }: SkinViewerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const viewerRef = useRef<SkinViewer3D | null>(null);

  useEffect(() => {
    if (!canvasRef.current || !skinUrl) return;

    if (viewerRef.current) {
      try { viewerRef.current.dispose(); } catch {}
      viewerRef.current = null;
    }

    try {
      const viewer = new SkinViewer3D({
        canvas: canvasRef.current,
        width,
        height,
        skin: skinUrl,
      });

      viewer.autoRotate = true;
      viewer.autoRotateSpeed = 1.5;

      if (capeUrl) {
        viewer.loadCape(capeUrl).catch(() => {});
      }

      viewerRef.current = viewer;
    } catch (err) {
      console.error('Ошибка 3D-скина:', err);
    }

    return () => {
      if (viewerRef.current) {
        try { viewerRef.current.dispose(); } catch {}
        viewerRef.current = null;
      }
    };
  }, [skinUrl, capeUrl, width, height]);

  if (!skinUrl) {
    return (
      <div className="skin-viewer-empty" style={{ width, height }}>
        <span>Нет скина</span>
      </div>
    );
  }

  return (
    <div className="skin-viewer">
      <canvas ref={canvasRef} width={width} height={height} />
    </div>
  );
}