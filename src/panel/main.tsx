import React from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource/ibm-plex-mono/latin-400.css';
import '@fontsource/ibm-plex-mono/latin-500.css';
import '../ui/index.css';
import { storeReady } from '../store/store';
import { VotesPage } from '../ui/VotesPage';

// L'écran attend les données enregistrées : sans ça il afficherait un instant « aucun serveur ».
storeReady.then(() => {
  createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <VotesPage />
    </React.StrictMode>
  );
});
