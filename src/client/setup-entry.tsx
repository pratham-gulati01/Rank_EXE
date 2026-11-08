import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { SetupApp } from './setup';

createRoot(document.getElementById('root')!).render(<StrictMode><SetupApp /></StrictMode>);
