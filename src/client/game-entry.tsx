import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './game';

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);
