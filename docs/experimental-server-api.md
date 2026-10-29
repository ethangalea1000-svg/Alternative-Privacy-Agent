# Alternative Privacy Agent (APA) — branche serveur expérimentale

APA est conçu comme un **tableau de bord privé pour organiser les alias numériques déjà utilisés**, pas comme un relais e-mail.

## Positionnement honnête

- APA organise des alias créés chez d'autres services et conserve leur service, catégorie, statut et notes.
- Les libellés internes APA sont des **identifiants de classement, pas des adresses e-mail fonctionnelles**.
- APA ne crée pas d'adresses e-mail, ne reçoit ni ne relaie les messages et ne remplace pas un fournisseur d'alias e-mail.
- Le prototype de la branche `main` reste sans compte et stocke les données dans le `localStorage` du navigateur.
- Cette branche expérimentale ajoute une API avec comptes, sessions et D1. Elle n'est pas connectée à l'interface publique.

## Environnement Worker de test — état déclaré après tests réels

- Worker : `apa-test-api`
- URL : https://apa-test-api.ethan-galea1000.workers.dev
- Liaison D1 configurée : variable `DB` → **uniquement** `apa-test-db`
- Base D1 : `apa-test-db`
- UUID vérifié : `69016374-48e7-4220-bce8-ea490c9de1fa`
- Migrations présentes : `0001`, `0002`, `0003`
- Tables attendues : `aliases`, `users`, `sessions`, `auth_login_limits`
- Jeu de données : données synthétiques uniquement, dont `test-synthetique`, quatre alias de test et un alias historique avec `owner_id IS NULL`.
- Aucun domaine personnalisé ni route de production ; l'API n'est pas reliée au site public.
- Le Worker est accessible sur Internet à son URL publique : utiliser exclusivement des identifiants et des données synthétiques et le désactiver lorsqu'il n'est plus nécessaire.

Ces éléments d'environnement et les résultats ci-dessous reflètent le compte rendu des tests manuels fourni par l'utilisateur ; ce document ne prétend pas que l'assistant a exécuté lui-même ces tests.

## Résultats des tests réels rapportés

| Scénario | Résultat rapporté |
|---|---|
| `GET /api/health` avec D1 disponible | `200`, `database: "ok"` |
| Inscription synthétique | `201`, cookie de session émis |
| `GET /api/auth/me` après inscription | `200` |
| Création d'un alias | `201` |
| Liste des alias | `200` |
| Validation de catégorie et de statut | Réussie |
| Déconnexion | `204` |
| `/api/auth/me` après déconnexion | `401` |
| Nouvelle connexion et données persistées | `200`, données retrouvées |
| POST avec origine non autorisée | `403`, `test_origin_not_allowed` |
| Validation du nom d'utilisateur et du mot de passe | Réussie : nom préfixé par `test-`, mot de passe de 10 à 128 caractères |
| Limitation de connexion | Après 10 échecs, le 11e renvoie `429 too_many_login_attempts`; le bon mot de passe est également bloqué pendant la fenêtre de 15 minutes |

Le compte rendu indique que tous ces tests ont passé après le correctif PBKDF2. Les journaux bruts, la date exacte d'exécution et un rapport CI indépendant ne sont pas inclus dans ce dépôt à ce stade.

### Note sur le rate limit

Une connexion réussie appelle `clearLoginFailures` et remet le compteur à zéro. Les tests de limitation doivent donc enchaîner les échecs sans connexion réussie entre eux. Ce comportement correspond au design actuel.

## PBKDF2 / Web Crypto : adaptation limitée au prototype de test

La version initiale utilisait 310 000 itérations et échouait dans le runtime Workers avec l'erreur rapportée : `iteration counts above 100000 are not supported (requested 310000)`. L'erreur avait été étiquetée à tort `database_error`, alors que D1 fonctionnait.

Le nombre d'itérations a été ramené à **100 000** pour rendre le prototype compatible avec la limite observée du runtime. C'est une adaptation technique **pour les tests uniquement** ; ce n'est ni une validation de robustesse pour la production, ni une équivalence de sécurité avec le paramétrage initial. Avant toute donnée réelle, une revue sécurité dédiée devra décider des paramètres de hachage adaptés au runtime, de la politique de mots de passe et des mesures de défense associées. Ne pas présenter ce paramétrage comme approuvé pour la production.

## Sécurité implémentée / attendue dans la branche expérimentale

- PBKDF2-SHA-256 avec sel aléatoire via Web Crypto.
- Jetons de session aléatoires ; seul leur hash est stocké.
- Cookie de session avec attributs de sécurité et expiration.
- Accès aux alias filtré par `owner_id`.
- Limitation persistante des tentatives de connexion par clés hachées.
- Validation des entrées, taille de corps JSON limitée et en-têtes de sécurité.

Ces protections doivent être vérifiées sur le code exact du Worker déployé et réconciliées avec la branche. Leur présence dans cette liste ne constitue pas une certification de sécurité.

## Migrations D1

1. `migrations/0001_initial.sql` — table des alias.
2. `migrations/0002_auth_and_ownership.sql` — utilisateurs, sessions et propriétaire des alias.
3. `migrations/0003_login_rate_limits.sql` — limitation des tentatives de connexion.

La contrainte SQL de catégorie invalide a été testée précédemment sur D1 et rejette la valeur non autorisée.

## Tests automatisés locaux

Node.js 20 ou plus récent :

    npm test

Les tests locaux doivent rester indépendants de Cloudflare et de la base distante. Ils ne doivent jamais exiger de secrets ou modifier une ressource Cloudflare.

### Couverture automatisée ajoutée

- `test/api.test.js` couvre maintenant aussi la conservation de l'alias legacy `owner_id IS NULL` (il reste présent mais invisible dans la liste de l'utilisateur connecté) et le rejet des cookies de session malformés sans requête D1.
- `test/api-edge-cases.test.js` couvre déjà les validations, les origines refusées, les méthodes non prises en charge, les corps JSON invalides/trop volumineux, les en-têtes de sécurité et les erreurs génériques.
- `test/remote-worker.test.js` est une suite **distante séparée et opt-in**. Elle ne crée ni utilisateur ni alias ; elle vérifie uniquement health/D1, session anonyme, origine refusée, JSON invalide, méthode non prise en charge, chemin inconnu, en-têtes et préflight CORS.
- La suite distante est ignorée par défaut, notamment dans `npm test` et la CI publique. Pour la lancer manuellement depuis PowerShell, après avoir vérifié que le Worker est toujours le Worker de test autorisé :

      $env:APA_RUN_REMOTE_TESTS = "1"
      node --test test/remote-worker.test.js

  Pour désigner une autre URL de test autorisée, définir au préalable `APA_TEST_API_BASE_URL`. Ne pas fournir de secrets. Ces tests distants sont non destructifs ; ils ne remplacent pas les scénarios authentifiés qui créent des données synthétiques et qui doivent rester exécutés manuellement avec un plan de nettoyage explicite.

## Tests D1 distants : périmètre et règles de sécurité

**Cible autorisée : uniquement `apa-test-db`**, UUID `69016374-48e7-4220-bce8-ea490c9de1fa`, accessible au Worker de test par `env.DB`.

- Ne jamais substituer une base de production, créer une autre ressource Cloudflare ou modifier le site public.
- Aucun test distant ne doit vider les tables, réinitialiser la base ou supprimer les fixtures existantes.
- N'utiliser que des comptes et alias synthétiques identifiés par un préfixe de campagne.
- Si un futur test crée des lignes, noter leurs identifiants et ne nettoyer que ces lignes, après vérification.
- Ne pas enregistrer de mot de passe, cookie ou jeton de session dans les logs ou artefacts.
- Ne pas connecter ces tests à la CI publique. Les tests distants doivent être déclenchés manuellement et être séparés de `npm test`.
- Ne pas lancer de migrations distantes supplémentaires sans autorisation explicite.

### Matrice de non-régression à compléter

- Schéma attendu et contraintes de catégorie/statut.
- Isolation entre deux utilisateurs : lecture, modification et suppression d'alias étrangers interdites.
- Conservation et inaccessibilité de l'alias historique avec `owner_id IS NULL`.
- Session absente, invalide et expirée ; logout et invalidation de session.
- Compteurs anti-brute-force : 10 échecs, blocage au 11e, remise à zéro après connexion réussie, expiration de la fenêtre.
- Méthodes HTTP non prises en charge, chemins inconnus, JSON invalide, mauvais `Content-Type`, corps trop volumineux.
- CORS / origines autorisées et refusées, cookies et en-têtes de sécurité.
- Vérification après les tests que les fixtures préexistantes sont toujours présentes.

Les tests réels rapportés couvrent déjà health, inscription, session, création/liste d'alias, validations, logout, persistance, origine refusée et limitation. Ils ne prouvent pas encore que toute cette matrice de non-régression est automatisée ni que tous les cas limites ont été testés sur le Worker.

## Revue sécurité du prototype de test

La revue source-level est consignée dans [`docs/security-review-test-prototype.md`](./security-review-test-prototype.md). Elle identifie notamment l'écart PBKDF2 entre le Worker testé et la branche, l'exposition Internet du Worker de test, le coût des inscriptions, les effets du verrouillage de compte et les différences CORS/cookies entre le Worker autonome et Pages Functions. Cette revue n'est pas une approbation de production ni un test d'intrusion indépendant.

## Réconciliation Worker de test ↔ branche expérimentale

La branche a été ajustée côté code (sans déploiement) pour aligner les contrôles test-only connus avec le Worker rapporté :

- PBKDF2-SHA-256 à 100 000 itérations, marqué explicitement comme paramètre de test uniquement.
- Noms d'utilisateur obligatoirement préfixés par `test-`.
- Limite de 20 comptes synthétiques et de 25 alias par utilisateur (garde-fous test-only ; les contrôles par comptage ne sont pas atomiques face à des requêtes concurrentes).
- Vérification de doublon et de plafond avant le calcul PBKDF2, afin d'éviter un coût inutile.
- `GET /api/health` vérifie désormais réellement que `env.DB` répond à `SELECT 1` et renvoie l'état de la base.
- Catégories, statuts, longueur de mot de passe, expiration des sessions et règle de limitation de connexion restent couverts par les tests locaux.

### Différences restantes, conservées volontairement

| Sujet | Worker autonome de test rapporté | Branche Pages Functions |
|---|---|---|
| Topologie navigateur | CORS autorisant certaines origines locales de développement ; cookie adapté au test cross-origin | API conçue en same-origin ; vérification stricte de `Origin`, cookie `SameSite=Lax` |
| Erreur d'origine refusée | `test_origin_not_allowed` rapporté | `same_origin_required` |
| Identifiant de service health | `apa-test-api` | `apa-api` |
| Source exécutée | Code collé dans le dashboard Cloudflare | Code versionné dans ce dépôt |

Ces différences de CORS/cookies sont liées à la topologie d'exécution et ne doivent pas être copiées aveuglément d'une variante à l'autre. L'alignement des règles métier ne signifie pas que les deux artefacts sont identiques octet par octet. La source exacte déployée dans le dashboard n'est pas versionnée dans le dépôt ; le rapprochement complet nécessite de la recopier dans un fichier dédié puis de vérifier son diff. Aucun changement de code n'a été déployé par cette étape.

## Limites restantes / critères avant toute évolution

1. [x] Ajouter les tests locaux de non-régression demandés ; le statut final CI est encore à confirmer après les derniers commits.
2. [x] Séparer les tests locaux, les tests SQLite en mémoire et la suite distante opt-in non destructive.
3. [~] Aligner les règles connues Worker/branche (PBKDF2 de test, préfixe `test-`, plafonds, health avec contrôle D1). La comparaison exacte du source déployé reste impossible tant que le code collé dans le dashboard n'est pas versionné ; les différences CORS/cookies sont documentées.
4. [x] Réaliser et documenter une revue sécurité source-level ; ce n'est pas un test d'intrusion ni une validation production.
5. [ ] Exécuter la suite distante opt-in et vérifier le comportement cookies/CORS dans un navigateur pris en charge. La suite distante n'a pas été exécutée par l'assistant.
6. [ ] Désactiver le Worker de test lorsqu'il n'est plus nécessaire.

**Aucune mise en production n'est approuvée.** La PR reste un brouillon non fusionné. Ne pas relier le Worker au site public, ne pas utiliser de données réelles et ne pas modifier de ressources de production sans autorisation distincte et explicite.
