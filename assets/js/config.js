/*
 * Configuration de l'application — Suivi des incidents de paiement PDV.
 * C'est le seul fichier à modifier pour adapter l'application.
 */
window.APP_CONFIG = {
  // URL de l'application Web Google Apps Script (voir README, « Mise en service »).
  // Tant qu'elle est vide, l'écran de connexion indique que l'application n'est pas reliée à sa base.
  API_URL: 'https://script.google.com/macros/s/AKfycbz71t6UUK_dP6mk1UZGeUAM3WUuuI-S6aVo47tF-z_3wSYu3P_DwHQiHwl_pTuyPRZl/exec',

  APP_TITRE: 'Suivi des Incidents de Paiement',
  APP_SOUS_TITRE: 'Points de vente — Dépôts, retraits Mobile Money & paiements de formalités',

  BACK_OFFICE: 'BACK OFFICE',

  // Agents du Back Office : chacun se connecte avec un code reçu par e-mail.
  // À garder identique à BO_UTILISATEURS dans apps-script/Code.gs.
  BO_UTILISATEURS: [
    { nom: 'Anne Adjo', poste: 'Opérateur', email: 'anne.niamkoun@cgi.ci' },
    { nom: 'Aminata Sow', poste: 'Assistant', email: 'aminata.sow@cgi.ci' },
    { nom: 'Axel Kouamenan', poste: 'Chef', email: 'axel.kouamenan@cgi.ci' },
    { nom: 'Zeinab Kone', poste: 'Responsable', email: 'zeinab.kone@cgi.ci' },
    { nom: 'Issa Kone', poste: 'Manager', email: 'issa.kone@cgi.ci' },
    { nom: 'Jansenus Koffi', poste: 'Manager', email: 'jansenus.koffi@cgi.ci' },
  ],
  OTP_MINUTES: 5,                 // validité du code de connexion envoyé par e-mail

  POINTS_DE_VENTE: [
    'ABOBO', 'ABOISSO', 'AGBOVILLE', 'ANGRE', 'BONDOUKOU', 'BONGOUANOU', 'BOUAKE',
    'BOUNA', 'BOUNDIALI', 'COSMOS', 'DAOUKRO', 'DIMBOKRO', 'DIVO', 'FERKE',
    'FOURRIERE ABOBO', 'FOURRIERE BASSAM', 'GUIGLO', 'KONG', 'MANKONO', 'KATIOLA',
    'ODIENNE', 'PHB', 'SASSANDRA', 'SEGUELA', 'TOUBA', 'SIEGE', 'VGE', 'YOPOUGON',
  ],

  OPERATEURS: [
    { code: 'ORANGE', nom: 'Orange Money', couleur: '#FF7900' },
    { code: 'MTN', nom: 'MTN MoMo', couleur: '#FFC000' },
    { code: 'MOOV', nom: 'Moov Money', couleur: '#0A57B5' },
    { code: 'WAVE', nom: 'Wave', couleur: '#1DC8F2' },
    { code: 'DOO', nom: 'Doo', couleur: '#00A389' },
    { code: 'DJAMO', nom: 'Djamo', couleur: '#6E3FE0' },
  ],

  // Incidents proposés pour un paiement de formalité.
  INCIDENTS_FORMALITE: [
    'Paiement en attente / non confirmé',
    'Montant débité erroné',
    'Double débit',
  ],

  // Suggestions pour le champ « Formalité voulue » (complétées par les saisies déjà faites).
  FORMALITES: [],

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
  ],

  SEUIL_ALERTE_HEURES: 48,        // « Nouveau » depuis plus longtemps = alerte
  SEUIL_MONTANT_ELEVE: 500000,    // FCFA — montants signalés dans les alertes
  ACTUALISATION_SECONDES: 60,     // rafraîchissement automatique (mode Google Sheets)
};
