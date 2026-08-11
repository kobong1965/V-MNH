import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { VelaAppErrorBoundary } from './vela/components/VelaAppErrorBoundary';
import './vela/vela.css';
import './vela/libtv.css';
import './vela/theme-dark.css';

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

const root = ReactDOM.createRoot(rootElement);
root.render(
  <React.StrictMode>
    <VelaAppErrorBoundary>
      <App />
    </VelaAppErrorBoundary>
  </React.StrictMode>
);
