import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';
import OfflineReady from './components/OfflineReady';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode><App /><OfflineReady /></React.StrictMode>,
);
