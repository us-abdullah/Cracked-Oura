import { useEffect, useState } from 'react';

/** True only in the phone/Vercel web mirror (set by web/src/main.tsx). Desktop Electron stays false. */
export function isWebMirror(): boolean {
  if (typeof document === 'undefined') return false;
  return document.documentElement.classList.contains('biotracker-web');
}

export function useIsWebMirror(): boolean {
  // Class is set before React mounts in web/main.tsx — safe to read once.
  return isWebMirror();
}

export function useIsMobileWeb(breakpointPx = 768): boolean {
  const web = isWebMirror();
  const [mobile, setMobile] = useState(false);

  useEffect(() => {
    if (!web) {
      setMobile(false);
      return;
    }
    const mq = window.matchMedia(`(max-width: ${breakpointPx}px)`);
    const apply = () => setMobile(mq.matches);
    apply();
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, [web, breakpointPx]);

  return web && mobile;
}
