# Suivi des Incidents de Paiement — Points de Vente

Application web de déclaration et de suivi des **paiements à problème** des points de vente (PDV) :

- **Dépôts et retraits Mobile Money** — Orange Money, Wave, MTN MoMo, Moov Money, Doo, Djamo ;
- **Paiements de formalités** — débit à tort, double débit, formalité non générée…

Chaque point de vente déclare ses incidents et suit leur traitement ; le **Back Office** prend en charge, trace ses actions (création de CA, demande de régularisation, clôture…) et pilote les statistiques de tous les points de vente.

Le site est un tableau de bord statique (HTML/CSS/JS, Chart.js, SheetJS, icônes Lucide), publiable gratuitement sur **GitHub Pages**. Son apparence reprend celle de la plateforme **iris** (QFS) : police Public Sans, couleurs du thème Flowbite, barre latérale avec le logo QFS. Les données partagées sont stockées dans une **feuille Google Sheets** via un petit script **Google Apps Script** fourni.

---

## Fonctionnalités

### Connexion — « Qui êtes-vous ? »
À l'ouverture, l'utilisateur choisit son profil : l'un des **28 points de vente** (ABOBO, ABOISSO, AGBOVILLE, ANGRE, BONDOUKOU, BONGOUANOU, BOUAKE, BOUNA, BOUNDIALI, COSMOS, DAOUKRO, DIMBOKRO, DIVO, FERKE, FOURRIERE ABOBO, FOURRIERE BASSAM, GUIGLO, KONG, MANKONO, KATIOLA, ODIENNE, PHB, SASSANDRA, SEGUELA, TOUBA, SIEGE, VGE, YOPOUGON) ou le **Back Office**. Un code d'accès peut être exigé par profil (facultatif, voir plus bas). Le profil reste connecté sur l'appareil jusqu'au clic sur **« Se déconnecter »**.

### Point de vente
- **Accueil** : trois boutons *Dépôt / Retrait / Formalité* pour déclarer en un clic, les incidents pour lesquels **le Back Office attend une réponse**, les indicateurs du PDV et les dernières nouvelles (non lues signalées).
- **Déclarer un incident** — assistant en 4 étapes :
  - *Dépôt / Retrait* : opérateur, montant (saisi avec séparateurs), date et heure (raccourcis « Maintenant », « Hier »…), n° du client, référence de la transaction.
  - *Paiement de formalité* : incident survenu, n° de liquidation, formalité voulue, montant, moyen de paiement.
  - Explication (phrases types proposées) et solution demandée, puis vérification avec **alerte de doublon** si un incident proche existe déjà. Un brouillon est conservé si l'assistant est fermé.
- **Mes déclarations** : en cours / clôturés, recherche, suivi en 4 étapes (Déclaré → Pris en charge → En traitement → Résolu), réponse au Back Office depuis le détail.
- **Statistiques** du PDV.

### Back Office
- **File de traitement** : À prendre en charge (du plus ancien au plus récent, retards > 48 h signalés) · En traitement (réponses des PDV en tête) · En attente du PDV · Clôturés sur 7 jours. Bouton **« Prendre en charge »** directement depuis la liste.
- **Détail d'un incident** : étape suivante proposée selon l'état, actions de suivi avec référence et commentaire (Prise en charge · Création de CA · Demande de régularisation · Relance opérateur · Demande d'information au PDV · Commentaire · Terminée · Rejetée), navigation vers l'incident suivant (touches J / K).
- **Pilotage** : indicateurs comparés à la période précédente, répartition par état, évolution, montants par nature, par opérateur, points de vente les plus concernés.
- **Registre** complet, triable et filtrable, et **Synthèse par PDV** avec indicateur de santé.

### Pour tous
- **Recherche rapide** d'un incident (Ctrl K ou /) par n°, référence, téléphone, liquidation…
- Export **Excel** (incidents, actions de suivi, synthèse par PDV) et impression / **PDF**.
- Thème clair / sombre, utilisable sur ordinateur et sur téléphone (barre d'onglets en bas).

### Cycle de vie d'un incident

| Statut | Signification |
|---|---|
| **Nouveau** | Déclaré par le PDV, pas encore pris en charge |
| **En cours** | Une action du Back Office est en cours (prise en charge, CA, régularisation, relance…) |
| **Terminé** | Résolu et clôturé par le Back Office |
| **Rejeté** | Jugé non fondé par le Back Office |

---

## Avant la mise en service

L'application ne contient aucune donnée : tout est enregistré dans la feuille Google Sheets. Tant que `API_URL` est vide dans `assets/js/config.js`, l'écran de connexion affiche « Application pas encore reliée à sa base de données » et personne ne peut se connecter.

---

## Mise en service

### 1. Publier le site (GitHub Pages)

Dans le dépôt GitHub : **Settings → Pages → Build and deployment → Source : Deploy from a branch**, branche `main`, dossier `/ (root)`.
Le site est ensuite disponible à l'adresse `https://<compte>.github.io/suivi-incidents-pdv/`.

### 2. Créer la base partagée (Google Sheets + Apps Script) — environ 5 minutes

1. Avec le compte Google de l'entreprise, créez une feuille **Google Sheets** vide (par ex. « Incidents PDV »).
2. Menu **Extensions → Apps Script**. Remplacez le contenu de `Code.gs` par celui du fichier [`apps-script/Code.gs`](apps-script/Code.gs), puis enregistrez.
3. Dans la liste des fonctions, choisissez **`setup`** puis **Exécuter**, et acceptez les autorisations demandées.
   Les onglets `Incidents`, `Actions` et `Acces` sont créés dans la feuille.
4. **Déployer → Nouveau déploiement** → type **Application Web** :
   - *Exécuter en tant que* : **Moi**
   - *Qui a accès* : **Tout le monde**
   Validez et copiez l'**URL de l'application Web** (elle se termine par `/exec`).
5. Dans [`assets/js/config.js`](assets/js/config.js), collez cette URL :
   ```js
   API_URL: 'https://script.google.com/macros/s/XXXXXXXX/exec',
   ```
   puis publiez la modification (commit + push). La liste « Qui êtes-vous ? » apparaît alors à la connexion.

> Après toute modification de `Code.gs` : **Déployer → Gérer les déploiements → ✏️ → Version : Nouvelle version → Déployer**. L'URL ne change pas.

### 3. Codes d'accès (recommandé)

Dans l'onglet **`Acces`** de la feuille, la colonne `code` contient un code par profil :

- code **vide** → accès direct en cliquant sur le profil (comportement par défaut) ;
- code **renseigné** → l'application le demande à la connexion.

Il est conseillé de mettre **au moins un code au Back Office**, puis un code par point de vente. La vérification est faite côté serveur : un point de vente ne reçoit jamais les incidents des autres.

---

## Personnalisation

Tout se règle dans [`assets/js/config.js`](assets/js/config.js) :

| Réglage | Rôle |
|---|---|
| `POINTS_DE_VENTE` | Liste des PDV affichés à la connexion. Pour un nouveau PDV, ajoutez-le aussi dans l'onglet `Acces`. |
| `OPERATEURS` | Opérateurs Mobile Money (code, nom, couleur). |
| `INCIDENTS_FORMALITE`, `FORMALITES` | Incidents proposés et suggestions de formalités. |
| `SOLUTIONS_MOBILE_MONEY`, `SOLUTIONS_FORMALITE` | Solutions que le PDV peut demander. |
| `ACTIONS_BO` | Actions du Back Office et statut qu'elles donnent. **À garder identique à `ACTIONS` dans `apps-script/Code.gs`.** |
| `SEUIL_ALERTE_HEURES`, `SEUIL_MONTANT_ELEVE` | Seuils des alertes. |
| `ACTUALISATION_SECONDES` | Rafraîchissement automatique des données (mode en ligne). |

---

## Structure

```
index.html              Page unique (connexion + tableau de bord)
assets/css/style.css    Styles (charte iris)
assets/img/logo-qfs.png Logo QFS
assets/js/config.js     Configuration (URL de l'API, PDV, opérateurs, listes…)
assets/js/store.js      Accès aux données (API Google Apps Script)
assets/js/app.js        Interface : connexion, statistiques, registre, déclaration, suivi
apps-script/Code.gs     Backend Google Apps Script (à coller dans la feuille Google Sheets)
```

## Tester en local

Servez le dossier avec n'importe quel serveur web, par exemple WampServer (`http://localhost/suivi-incidents-pdv/`) ou :

```bash
npx serve .
```

Ajoutez `?demo` à l'adresse (ex. `index.html?demo`) pour tester l'interface avec des **données fictives** : rien n'est envoyé à Google Sheets.

## À savoir

- Le site GitHub Pages est public : protégez l'accès aux données avec les **codes d'accès** et ne partagez la feuille Google Sheets qu'avec le Back Office.
- Le profil et son code restent mémorisés sur l'appareil jusqu'à « Se déconnecter » ; sur un poste partagé, pensez à vous déconnecter en partant.
- La feuille Google Sheets reste consultable et exportable directement par le Back Office.
