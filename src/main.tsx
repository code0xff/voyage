import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { initialTheme } from '@/lib/theme';
import { App } from '@/ui/App';
import './index.css';

// Set the theme before the first paint so there is no flash of the wrong one.
document.documentElement.classList.toggle('dark', initialTheme() === 'dark');

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
