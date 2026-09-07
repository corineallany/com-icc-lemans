# Code Harmony Audit

J’ai une application existante déjà fonctionnelle mais techniquement instable car plusieurs couches de correctifs se sont accumulées. Je vais te fournir le code actuel, l’accès GitHub, l’accès Supabase et trois documents de référence.
Ne modifie rien pour l’instant. Commence par auditer l’ensemble, identifier les doublons, anciennes couches, sources d’état concurrentes, fonctions redondantes, risques de perte de données et dépendances entre modules.

This project was built with [Lovable](https://lovable.dev).

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/6df8a5e7-3db0-4ffb-96cd-fde4d4e89b8d).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Terminologie fonctionnelle

- **Demandes ponctuelles** : module transversal pour les renforts, remplacements et autres besoins ponctuels. Le chemin technique `/sollicitations` et les identifiants de base de données historiques restent inchangés afin de préserver la compatibilité.
- **Sollicitation dans un programme** : demande de participation liée à un programme et à un besoin précis, avec réponse attendue du membre.
- **Affectation directe** : participation confirmée immédiatement, sans réponse attendue.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```
