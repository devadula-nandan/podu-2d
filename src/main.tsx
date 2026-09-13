import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { App } from './App.js';
import './ui/styles.css';
import './player/styles.css';

const container = document.getElementById('root');
if (container === null) throw new Error('missing #root element in index.html');

const basename = import.meta.env.BASE_URL.replace(/\/$/, '');

createRoot(container).render(
  <StrictMode>
    <BrowserRouter {...(basename === '' ? {} : { basename })}>
      <App />
    </BrowserRouter>
  </StrictMode>,
);
