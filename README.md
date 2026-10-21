# Maison Sucrée

Boutique d’événement avec une interface web et un véritable serveur Node.js/Express. Le serveur conserve le panier commandé dans une base SQLite locale, vérifie les paiements PayPal côté serveur et confirme le montant avant de marquer une commande payée.

## Lancer le site

1. Installez **Node.js 22.13 ou plus récent** si ce n’est pas déjà fait.
2. Double-cliquez sur [`Lancer.bat`](./Lancer.bat).
3. Le script installe les dépendances si nécessaire, initialise la base, démarre le serveur et ouvre `http://localhost:3000`.

Double-cliquez sur [`Arreter.bat`](./Arreter.bat) pour arrêter le serveur.

La base est conservée dans `data/orders.sqlite`. Le front-end se trouve dans `public/`, les routes et l’intégration PayPal dans `server.js`, les opérations sur la base dans `db/` et la validation des paiements dans `server/`. Le navigateur ne peut pas accéder aux fichiers du serveur ni au secret PayPal.

Les seuls outils installés automatiquement sont les dépendances de l’application via npm. Aucun Docker, serveur PostgreSQL ni compte Railway n’est nécessaire pour lancer la boutique sur cet ordinateur.

## Paiement PayPal : configuration requise une seule fois

Le site accepte les commandes et garde le panier si PayPal n’est pas encore configuré. **Un paiement ne peut pas être simulé ni encaissé sans les identifiants d’une application PayPal marchand.** Ces identifiants doivent appartenir à votre compte ; je ne peux pas créer ce compte ou ses secrets à votre place.

Pour d’abord essayer sans encaisser de vrais fonds :

1. Connectez-vous au [tableau de bord PayPal Developer](https://developer.paypal.com/dashboard/) avec votre compte marchand.
2. Ouvrez **Apps & Credentials**, sélectionnez **Sandbox**, puis créez une application marchand Checkout.
3. Copiez son **Client ID** et son **Secret Sandbox**.
4. Ouvrez `.env` à la racine du projet et remplacez les deux valeurs vides :

   ```dotenv
   PAYPAL_ENV=sandbox
   PAYPAL_CLIENT_ID=collez-ici-le-client-id-sandbox
   PAYPAL_CLIENT_SECRET=collez-ici-le-secret-sandbox
   ```

5. Enregistrez `.env`, puis double-cliquez de nouveau sur `Lancer.bat`.
6. Utilisez un compte **acheteur Sandbox** pour tester. L’application marchand Sandbox et le compte acheteur Sandbox sont distincts.

Pour recevoir de vrais paiements, le compte marchand doit pouvoir en recevoir et `.env` doit contenir le Client ID et le Secret de l’application **Live** avec `PAYPAL_ENV=live`. Ne partagez jamais le Secret, ne l’ajoutez jamais à `public/` ni au dépôt Git. Le site affiche une erreur explicite si PayPal refuse les identifiants ou si l’environnement ne correspond pas.

## Transmettre la commande à l’atelier

Après une capture PayPal vérifiée, la commande reste enregistrée dans la base. La page compose un e-mail récapitulatif qui s’ouvre dans Gmail ou le logiciel de messagerie, et permet aussi de copier les détails. **L’e-mail doit encore être envoyé manuellement** : aucune adresse d’expédition ni aucun service de messagerie n’a été fourni.

Remplacez `WORKSHOP_EMAIL` dans `.env` par l’adresse réelle de l’atelier avant les essais.

## Base de données

Le schéma SQLite (`db/schema.sql`) est créé automatiquement au premier lancement. Chaque commande stocke son identifiant PayPal, ses articles, le total en centimes, les coordonnées nécessaires à l’atelier, son statut de paiement et les références de capture. Le serveur recalcule les prix depuis le catalogue, et n’utilise jamais les montants envoyés par le navigateur pour encaisser.

Les fichiers `.env`, la base et les journaux locaux sont exclus de Git. Pour sauvegarder les commandes, arrêtez le serveur puis copiez `data/orders.sqlite`.

## Tests

```sh
npm test
```

Les tests vérifient les règles de panier et de prix, la validation des captures PayPal et les opérations de stockage SQLite. Un paiement réel Sandbox nécessite l’application PayPal Sandbox mentionnée plus haut.
