# Alternative Privacy Agent (APA)

APA est un **tableau de bord privé pour organiser les alias numériques que vous utilisez déjà**. Le prototype du site fonctionne sans compte : les données restent dans le stockage local (`localStorage`) du navigateur.

## Ce qu'APA fait — et ne fait pas

- Organise les alias créés chez d'autres services, avec le nom du service/site, une catégorie, un statut et des notes.
- Permet de modifier et supprimer des entrées et d'importer/exporter une sauvegarde JSON.
- Inclut une fiche « Mon pseudonyme » et une checklist d’hygiène numérique, saisies par l’utilisateur et stockées localement.
- Le prototype local ne nécessite aucun compte APA et n'envoie pas les données au serveur.
- Les libellés générés par APA sont des **identifiants de classement, pas des adresses e-mail fonctionnelles**.
- APA ne crée pas de véritables adresses e-mail, ne relaie pas les messages et ne remplace pas un fournisseur d'alias e-mail.

## Confidentialité et sauvegardes

Le prototype enregistre les alias et la fiche pseudonyme dans le stockage local du navigateur sur cet appareil et ce profil de navigateur. Les champs de la fiche sont vides par défaut et aucun attribut n’est généré. Il ne synchronise pas les appareils. La suppression des données du navigateur peut effacer ces entrées. L'export JSON est une sauvegarde non chiffrée : gardez le fichier dans un emplacement sûr et ne le partagez pas s'il contient des informations privées. N'enregistrez jamais de mots de passe ou de données sensibles dans les notes.

## Versions

- **Prototype local (`main`)** : stockage navigateur uniquement, sans compte APA.
- **Branche serveur (`feat/cloudflare-d1-api-tests`)** : expérimentation distincte avec Worker/D1 et authentification. Elle n'est pas déployée et n'est pas nécessaire pour utiliser le prototype local.

## Tests

Node.js 20 ou plus récent :

    npm test

Les tests automatisés vérifient les fonctions de validation, les sauvegardes JSON et, sur la branche serveur, les endpoints d'authentification et l'isolation par propriétaire.
