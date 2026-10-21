/*
 * Configuration de l'application — Suivi des incidents de paiement PDV.
 * C'est le seul fichier à modifier pour adapter l'application.
 */
window.APP_CONFIG = {
  // URL de l'application Web Google Apps Script (voir README, « Mise en service »).
  // Tant qu'elle est vide, l'écran de connexion indique que l'application n'est pas reliée à sa base.
  API_URL: '',

  APP_TITRE: 'Suivi des Incidents de Paiement',
  APP_SOUS_TITRE: 'Points de vente — Dépôts, retraits Mobile Money & paiements de formalités',

  BACK_OFFICE: 'BACK OFFICE',

  POINTS_DE_VENTE: [
    'ABOBO', 'ABOISSO', 'AGBOVILLE', 'ANGRE', 'BONDOUKOU', 'BONGOUANOU', 'BOUAKE',
    'BOUNA', 'BOUNDIALI', 'COSMOS', 'DAOUKRO', 'DIMBOKRO', 'DIVO', 'FERKE',
    'FOURRIERE ABOBO', 'FOURRIERE BASSAM', 'GUIGLO', 'KONG', 'MANKONO', 'KATIOLA',
    'ODIENNE', 'PHB', 'SASSANDRA', 'SEGUELA', 'TOUBA', 'SIEGE', 'VGE', 'YOPOUGON',
  ],

  OPERATEURS: [
    { code: 'ORANGE', nom: 'Orange Money', couleur: '#FF7900' },
    { code: 'WAVE', nom: 'Wave', couleur: '#1DC8F2' },
    { code: 'MTN', nom: 'MTN MoMo', couleur: '#FFC000' },
    { code: 'MOOV', nom: 'Moov Money', couleur: '#0A57B5' },
    { code: 'DOO', nom: 'Doo', couleur: '#00A389' },
    { code: 'DJAMO', nom: 'Djamo', couleur: '#6E3FE0' },
  ],

  // Incidents proposés pour un paiement de formalité.
  INCIDENTS_FORMALITE: [
    'Débit à tort',
    'Double débit',
    'Débité mais formalité non générée',
    'Montant débité erroné',
    'Paiement en attente / non confirmé',
    'Autre',
  ],

  // Suggestions pour le champ « Formalité voulue » (complétées par les saisies déjà faites).
  FORMALITES: [],

  // Solutions que le point de vente peut demander.
  SOLUTIONS_MOBILE_MONEY: [
    'Remboursement du client',
    "Annulation de l'opération",
    "Finalisation / validation de l'opération",
    'Régularisation du compte (re-crédit)',
    "Vérification du statut auprès de l'opérateur",
    'Autre',
  ],
  SOLUTIONS_FORMALITE: [
    'Remboursement du client',
    'Génération / validation de la formalité',
    'Annulation du débit',
    'Régularisation',
    'Autre',
  ],

  // Actions de suivi du Back Office et statut qu'elles donnent à l'incident
  // (null = le statut ne change pas). À garder identique à ACTIONS dans apps-script/Code.gs.
  ACTIONS_BO: [
    { code: 'PRISE_EN_CHARGE', libelle: 'Prise en charge', statut: 'EN_COURS' },
    { code: 'CREATION_CA', libelle: 'Création de CA', statut: 'EN_COURS' },
    { code: 'DEMANDE_REGULARISATION', libelle: 'Demande de régularisation', statut: 'EN_COURS' },
    { code: 'RELANCE', libelle: 'Relance opérateur', statut: 'EN_COURS' },
    { code: 'INFO_PDV', libelle: "Demande d'information au PDV", statut: 'EN_COURS' },
    { code: 'COMMENTAIRE', libelle: 'Commentaire', statut: null },
    { code: 'TERMINE', libelle: 'Terminée (résolue)', statut: 'TERMINE' },
    { code: 'REJETE', libelle: 'Rejetée (non fondée)', statut: 'REJETE' },
  ],

  SEUIL_ALERTE_HEURES: 48,        // « Nouveau » depuis plus longtemps = alerte
  SEUIL_MONTANT_ELEVE: 500000,    // FCFA — montants signalés dans les alertes
  ACTUALISATION_SECONDES: 60,     // rafraîchissement automatique (mode Google Sheets)
};
