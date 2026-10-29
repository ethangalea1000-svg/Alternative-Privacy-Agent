# Alternative Privacy Agent (APA) — branche serveur expérimentale

APA est conçu comme un **tableau de bord privé pour organiser les alias numériques déjà utilisés**, pas comme un relais e-mail.

## Positionnement honnête

- APA peut organiser des alias créés chez d'autres services et conserver leur site/service, leur catégorie, leur statut et des notes.
- Les libellés internes APA sont des **identifiants de classement, pas des adresses e-mail fonctionnelles**.
- APA ne crée pas d'adresses e-mail, ne reçoit ni ne relaie les messages et ne remplace pas un fournisseur d'alias e-mail.
- Le prototype de la branche `main` est sans compte et stocke les données dans le `localStorage` du navigateur.
- Cette branche expérimentale ajoute une API Worker avec comptes, sessions et D1. Elle ne constitue donc pas la version sans compte : les données de l'API sont liées à un utilisateur.

## Sécurité implémentée dans cette branche

- Mots de passe hachés avec PBKDF2-SHA-256 et sel aléatoire via Web Crypto.
- Sessions aléatoires dont seul le hash est stocké, cookie `HttpOnly`, `Secure`, `SameSite=Lax`, expiration et rotation à la connexion.
- Requêtes d'alias filtrées par `owner_id`.
- Limitation persistante des tentatives de connexion : 10 échecs dans une fenêtre entraînent un blocage temporaire de 15 minutes, par IP et par nom d'utilisateur, avec clés hachées.
- En-têtes de sécurité appliqués par le middleware API, dont CSP, `X-Content-Type-Options` et `Referrer-Policy`.

## Migrations D1

Les migrations sont des fichiers SQL versionnés :

1. `migrations/0001_initial.sql` — table des alias.
2. `migrations/0002_auth_and_ownership.sql` — utilisateurs, sessions et propriétaire des alias.
3. `migrations/0003_login_rate_limits.sql` — limitation des tentatives de connexion.

**Aucune migration distante n'a été exécutée par les changements de code décrits ici. Aucun déploiement ni aucune ressource Cloudflare n'est créé par les tests CI.** Avant toute mise en production, il faudra examiner et appliquer ces migrations avec autorisation explicite, tester sur une base D1 de test, vérifier les en-têtes réels et définir une procédure de sauvegarde/retour arrière.

## Tests

Node.js 20 ou plus récent :

    npm test

La CI teste les endpoints d'authentification, les sessions, l'isolation des alias, les tentatives de connexion répétées, les en-têtes et les validations. Les tests automatisés ne remplacent pas un audit de déploiement réel.
