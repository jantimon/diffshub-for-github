import { useCallback, useState, type PointerEvent as ReactPointerEvent } from 'react';

import { readSetting, writeSetting } from '@/viewer/settings';

const NARROWEST = 160;
const WIDEST = 720;

/** The file tree's width, dragged by its edge and remembered */
export function useSidebarWidth(): {
  width: number;
  startResize: (event: ReactPointerEvent<HTMLElement>) => void;
} {
  const [width, setWidth] = useState(() => Number(readSetting('sidebarWidth', '280')) || 280);

  const startResize = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      event.preventDefault();
      const startX = event.clientX;
      let next = width;
      const onMove = (move: globalThis.PointerEvent): void => {
        next = Math.min(Math.max(width + move.clientX - startX, NARROWEST), WIDEST);
        setWidth(next);
      };
      const onUp = (): void => {
        removeEventListener('pointermove', onMove);
        removeEventListener('pointerup', onUp);
        document.body.style.cursor = '';
        writeSetting('sidebarWidth', String(next));
      };
      document.body.style.cursor = 'col-resize';
      addEventListener('pointermove', onMove);
      addEventListener('pointerup', onUp);
    },
    [width],
  );

  return { width, startResize };
}
