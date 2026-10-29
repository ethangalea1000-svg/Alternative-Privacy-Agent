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

### État de la base D1 de test

Une base Cloudflare D1 **de test isolée** a été créée manuellement et vérifiée dans le tableau de bord :

- Nom : `apa-test-db`
- UUID : `69016374-48e7-4220-bce8-ea490c9de1fa`
- Migrations `0001`, `0002` et `0003` appliquées.
- Tables vérifiées : `aliases`, `users`, `sessions`, `auth_login_limits`.
- Données présentes : uniquement des données synthétiques, dont l'utilisateur `test-synthetique` et quatre alias de test ; un alias historique conserve un `owner_id` nul.
- Vérification réelle déjà effectuée : une insertion avec une catégorie invalide est rejetée par la contrainte SQL `CHECK`.

Cette base n'est pas reliée au site public ; aucun déploiement n'a été effectué. Cette documentation consigne l'état déclaré et vérifié de la base, mais ne constitue pas une autorisation de la lier à un Worker, à Pages ou à la CI.

## Plan de tests d'intégration D1 — à exécuter après autorisation explicite

**Cible prévue : uniquement `apa-test-db` (UUID ci-dessus).** Ne jamais substituer une base de production, créer une autre ressource Cloudflare ou lancer une migration distante sans autorisation explicite.

### Préconditions et garde-fous

1. Obtenir une autorisation explicite pour configurer la liaison D1 et exécuter des tests distants.
2. Vérifier dans le tableau de bord le nom et l'UUID de la base cible avant toute commande distante.
3. N'ajouter la liaison D1 qu'à une configuration de test dédiée. Ne pas connecter le site public ni activer de déploiement.
4. Ne pas lancer automatiquement ces tests depuis la CI publique. Les tests distants devront être déclenchés manuellement et séparés de `npm test`.
5. Utiliser uniquement des comptes et alias synthétiques. Aucun vrai mot de passe, e-mail, alias personnel ou autre donnée personnelle.
6. Préfixer les nouvelles données de test par un identifiant de campagne unique ; supprimer uniquement les lignes créées par cette campagne. Ne pas vider les tables ni modifier/supprimer les fixtures existantes.
7. Si l'identité de la base, la liaison ou le périmètre des données est ambigu, arrêter les tests et demander confirmation.

### Cas à couvrir

- **Schéma et migrations** : confirmer que les quatre tables attendues existent et que les migrations sont appliquées dans l'ordre prévu, sans relancer de migration distante par défaut.
- **Contraintes de catégorie et de statut** : vérifier qu'une catégorie ou un statut invalide est rejeté par D1. Le rejet d'une catégorie invalide a déjà été testé ; conserver ce cas comme contrôle de régression.
- **Compatibilité historique** : vérifier que l'alias legacy avec `owner_id IS NULL` est conservé et reste inaccessible aux utilisateurs authentifiés.
- **Propriété et isolation** : créer deux utilisateurs synthétiques et vérifier qu'un utilisateur ne peut ni lire, ni modifier, ni supprimer les alias de l'autre.
- **Sessions et clés étrangères** : vérifier les relations utilisateur/session, l'expiration de session et les cascades prévues, uniquement sur des lignes de test nouvellement créées.
- **Limitation des connexions** : tester les compteurs, le blocage temporaire et la fenêtre de limitation sans générer de charge importante.
- **Nettoyage** : vérifier le nombre et les identifiants des lignes créées par le test avant de supprimer uniquement ces lignes ; confirmer que les fixtures initiales, notamment l'alias legacy, sont toujours présentes.

### Résultat à consigner

Pour chaque exécution, noter la date, l'UUID cible vérifié, la version du commit, les cas réussis/échoués et toute modification de données. Ne pas consigner de secrets ni de jetons de session. Un résultat positif sur D1 ne prouve pas à lui seul le comportement du runtime Pages/Workers ou la sécurité d'un futur déploiement.

## Tests automatisés locaux

Node.js 20 ou plus récent :

    npm test

La CI actuelle teste les endpoints d'authentification, les sessions, l'isolation des alias, les tentatives de connexion répétées, les en-têtes et les validations à l'aide de doubles/in-memory SQLite. Ces tests ne se connectent pas à `apa-test-db`. Les tests D1 distants décrits ci-dessus restent une étape manuelle, conditionnée à une autorisation explicite.

## Limites de déploiement

Aucune liaison de la base à l'application publique, aucun déploiement et aucune activation de l'API publique ne sont autorisés par cette documentation. Avant toute décision de déploiement, il faudra examiner les migrations, tester les en-têtes et le runtime réel dans un environnement non productif, définir une sauvegarde et une procédure de retour arrière, puis obtenir une autorisation distincte.
