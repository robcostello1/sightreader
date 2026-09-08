import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Flash } from './flash/Flash';
import { applyTheme } from './lib/theme';
import { Heading } from './ui/Text';
import './index.css';

const requested = new URLSearchParams(location.search).get('theme');
if (requested === 'light' || requested === 'dark') applyTheme(requested);

/**
 * Dev-only page for the recognition mode, served at /flash.html.
 *
 * It lives here rather than in the app because where a second mode belongs —
 * beside the lesson, behind a switch, in its own level ramp — is a question
 * nobody has answered yet. The mechanic can be tried without settling that.
 */
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <main>
      <Heading level={1} className="preview-title">Flash recognition</Heading>
      <Flash />
    </main>
  </StrictMode>,
);
