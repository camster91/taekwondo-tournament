import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import App from './App';
import './index.css';

// Surface React render errors so they show up in the browser console
// with the actual message, not as silent empty root
window.addEventListener('error', (e) => {
  console.error('[window.error]', e.message, e.error?.stack || e.error);
});
window.addEventListener('unhandledrejection', (e) => {
  console.error('[unhandledrejection]', e.reason?.message || e.reason, e.reason?.stack);
});
const origConsoleError = console.error;
console.error = (...args) => {
  origConsoleError.apply(console, ['[CONSOLE.ERROR]', ...args]);
};

if (import.meta.env.VITE_POSTHOG_KEY) {
  // posthog.init(import.meta.env.VITE_POSTHOG_KEY, { api_host: 'https://app.posthog.com' })
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60, // 1 minute
      retry: 1,
    },
  },
});

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </QueryClientProvider>
  </React.StrictMode>
);
