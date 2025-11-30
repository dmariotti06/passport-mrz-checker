// Nom du cache (change-le manuellement à chaque MAJ majeure si besoin)
const CACHE_NAME = "mrz-visa-cache-v1";

// Fichiers autorisés à être mis en cache (mode offline strict)
const CACHE_ASSETS = [
  "./manifest.json",
  "./rules/visa_rules.json",
  "./rules/visa_rules_version.json",
  "./assets/icons/icon-192.png",
  "./assets/icons/icon-512.png"
];

// Fichiers toujours chargés en direct (jamais depuis le cache)
const NETWORK_ONLY = [
  "index.html",
  "app.js",
  "style.css"
];

// INSTALLATION — préchargement des fichiers indispensables offline
self.addEventListener("install", (event) => {
  self.skipWaiting(); // active immédiatement la nouvelle version

  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(CACHE_ASSETS);
    })
  );
});

// ACTIVATION — supprime les anciens caches + prend immédiatement le contrôle
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      )
    )
  );

  clients.claim(); // force tous les onglets à utiliser ce SW maintenant
});

// FETCH — stratégie de sécurité cache STRICTE
self.addEventListener("fetch", (event) => {
  const requestURL = new URL(event.request.url);

  // Si ce fichier fait partie des fichiers SENSIBLES (HTML/JS/CSS)
  // → Toujours forcé en réseau
  if (NETWORK_ONLY.some((path) => requestURL.pathname.endsWith(path))) {
    event.respondWith(
      fetch(event.request)
        .then((response) => response) // utilisation immédiate de la nouvelle version
        .catch(() => caches.match(event.request)) // fallback offline si impossible
    );
    return;
  }

  // Pour les autres ressources → cache-first strict
  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;

      return fetch(event.request)
        .then((response) => {
          // On met en cache uniquement les ressources autorisées
          if (CACHE_ASSETS.some((allowed) => requestURL.pathname.endsWith(allowed))) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          }
          return response;
        })
        .catch(() => cached);
    })
  );
});

