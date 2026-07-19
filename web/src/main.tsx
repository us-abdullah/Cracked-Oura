import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

// Mark web mirror so shared frontend can apply phone-only layout (desktop Electron stays untouched)
document.documentElement.classList.add('biotracker-web');

// Shared desktop styles + app shell — edits in frontend/src show up automatically
import '../../frontend/src/index.css';
import './web-mobile.css';
import App from '../../frontend/src/App.tsx';
import { ThemeProvider } from '../../frontend/src/components/theme-provider';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider defaultTheme="dark" storageKey="vite-ui-theme">
      <App />
    </ThemeProvider>
  </StrictMode>
);
