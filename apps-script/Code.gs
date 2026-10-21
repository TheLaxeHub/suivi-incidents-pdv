/**
 * Suivi des incidents de paiement — Points de vente
 * Backend Google Apps Script : la feuille Google Sheets sert de base de données.
 *
 * Mise en service : voir README.md (section « Mise en service »).
 *   1. Coller ce fichier dans Extensions > Apps Script de la feuille Google Sheets.
 *   2. Exécuter une fois la fonction setup() (autorisations + création des onglets).
 *   3. Déployer > Nouveau déploiement > Application Web
 *      (Exécuter en tant que : Moi — Qui a accès : Tout le monde).
 *   4. Copier l'URL /exec dans assets/js/config.js (API_URL).
 *
 * Onglets créés :
 *   - Incidents : une ligne par incident déclaré.
 *   - Actions   : historique des actions (Back Office et compléments des PDV).
 *   - Acces     : un code d'accès facultatif par profil (vide = pas de code).
 */

const BACK_OFFICE = 'BACK OFFICE';

const POINTS_DE_VENTE = [
  'ABOBO', 'ABOISSO', 'AGBOVILLE', 'ANGRE', 'BONDOUKOU', 'BONGOUANOU', 'BOUAKE',
  'BOUNA', 'BOUNDIALI', 'COSMOS', 'DAOUKRO', 'DIMBOKRO', 'DIVO', 'FERKE',
  'FOURRIERE ABOBO', 'FOURRIERE BASSAM', 'GUIGLO', 'KONG', 'MANKONO', 'KATIOLA',
  'ODIENNE', 'PHB', 'SASSANDRA', 'SEGUELA', 'TOUBA', 'SIEGE', 'VGE', 'YOPOUGON',
];

// À garder identique à ACTIONS_BO dans assets/js/config.js.
const ACTIONS = {
  PRISE_EN_CHARGE: { libelle: 'Prise en charge', statut: 'EN_COURS', bo: true },
  CREATION_CA: { libelle: 'Création de CA', statut: 'EN_COURS', bo: true },
  DEMANDE_REGULARISATION: { libelle: 'Demande de régularisation', statut: 'EN_COURS', bo: true },
  RELANCE: { libelle: 'Relance opérateur', statut: 'EN_COURS', bo: true },
  INFO_PDV: { libelle: "Demande d'information au PDV", statut: 'EN_COURS', bo: true },
  COMMENTAIRE: { libelle: 'Commentaire', statut: null, bo: true },
  TERMINE: { libelle: 'Terminée (résolue)', statut: 'TERMINE', bo: true },
  REJETE: { libelle: 'Rejetée (non fondée)', statut: 'REJETE', bo: true },
  COMPLEMENT: { libelle: "Complément d'information du PDV", statut: null, bo: false },
};
const COMMENTAIRE_OBLIGATOIRE = ['COMMENTAIRE', 'COMPLEMENT', 'INFO_PDV', 'REJETE'];

const COLS_INCIDENTS = [
  'id', 'cree_le', 'pdv', 'declarant', 'categorie', 'type_operation', 'operateur',
  'date_operation', 'montant', 'telephone', 'reference', 'incident', 'num_liquidation',
  'formalite', 'description', 'solution', 'statut', 'derniere_action', 'maj_le', 'cloture_le',
];
const COLS_ACTIONS = [
  'id', 'incident_id', 'cree_le', 'auteur', 'agent', 'code', 'libelle', 'reference',
  'commentaire', 'statut_apres',
];

/* ------------------------------------------------------------------ */
/* Points d'entrée                                                     */
/* ------------------------------------------------------------------ */

function doGet() {
  return json_({ ok: true, message: 'API Suivi des incidents PDV opérationnelle.' });
}

function doPost(e) {
  let out;
  try {
    const req = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    out = route_(req);
  } catch (err) {
    out = { ok: false, code: err.code || 'ERREUR', message: err.message || String(err) };
  }
  return json_(out);
}

/** À exécuter une fois depuis l'éditeur : crée les onglets et mémorise la feuille. */
function setup() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  PropertiesService.getScriptProperties().setProperty('SHEET_ID', ss.getId());
  base_();
  Logger.log('Onglets prêts. Déployez maintenant le script en Application Web.');
}

/* ------------------------------------------------------------------ */
/* Routage et authentification                                         */
/* ------------------------------------------------------------------ */

function route_(req) {
  const sess = auth_(req.profil, req.code);
  switch (req.action) {
    case 'login':
      return { ok: true, profil: sess.profil, isBO: sess.isBO };
    case 'list':
      return Object.assign({ ok: true }, lister_(sess));
    case 'create':
      return { ok: true, incident: creer_(sess, req.data || {}) };
    case 'addAction':
      return Object.assign({ ok: true }, ajouterAction_(sess, req.data || {}));
    default:
      throw erreur_('ACTION_INCONNUE', 'Action inconnue.');
  }
}

function auth_(profil, code) {
  const p = String(profil || '').trim().toUpperCase();
  if (!p) throw erreur_('PROFIL_INCONNU', 'Profil manquant.');
  const acces = base_().acces.getDataRange().getValues().slice(1);
  const ligne = acces.find(function (r) { return String(r[0]).trim().toUpperCase() === p; });
  if (!ligne) throw erreur_('PROFIL_INCONNU', 'Profil « ' + p + ' » inconnu.');
  const attendu = String(ligne[1] || '').trim();
  if (attendu) {
    if (!code) throw erreur_('CODE_REQUIS', "Code d'accès requis.");
    if (String(code).trim() !== attendu) throw erreur_('CODE_INVALIDE', "Code d'accès incorrect.");
  }
  return { profil: p, isBO: p === BACK_OFFICE };
}

/* ------------------------------------------------------------------ */
/* Métier                                                              */
/* ------------------------------------------------------------------ */

function lister_(sess) {
  const db = base_();
  let incidents = lire_(db.incidents, COLS_INCIDENTS);
  if (!sess.isBO) incidents = incidents.filter(function (i) { return i.pdv === sess.profil; });
  const ids = {};
  incidents.forEach(function (i) { ids[i.id] = true; });
  const actions = lire_(db.actions, COLS_ACTIONS).filter(function (a) { return ids[a.incident_id]; });
  return { incidents: incidents, actions: actions };
}

function creer_(sess, data) {
  if (sess.isBO) throw erreur_('INTERDIT', 'Seul un point de vente peut déclarer un incident.');
  const inc = valider_(data);
  return verrou_(function () {
    const db = base_();
    const now = new Date().toISOString();
    inc.id = prochainId_(db.incidents);
    inc.cree_le = now;
    inc.pdv = sess.profil;
    inc.declarant = inc.declarant || sess.profil;
    inc.statut = 'NOUVEAU';
    inc.derniere_action = 'Déclaration';
    inc.maj_le = now;
    inc.cloture_le = '';
    db.incidents.appendRow(versLigne_(inc, COLS_INCIDENTS));
    return inc;
  });
}

function ajouterAction_(sess, data) {
  const code = String(data.code || '');
  const def = ACTIONS[code];
  if (!def) throw erreur_('ACTION_INCONNUE', 'Action de suivi inconnue.');
  if (def.bo !== sess.isBO) throw erreur_('INTERDIT', "Cette action n'est pas autorisée pour votre profil.");
  const commentaire = texte_(data.commentaire, 2000);
  if (COMMENTAIRE_OBLIGATOIRE.indexOf(code) >= 0 && !commentaire) {
    throw erreur_('VALIDATION', 'Un commentaire est obligatoire pour cette action.');
  }
  // Un point de vente agit en son nom ; seul le Back Office indique l'agent.
  const agent = texte_(data.agent, 80) || (sess.isBO ? '' : sess.profil);
  if (!agent) throw erreur_('VALIDATION', "Indiquez le nom de l'agent.");

  return verrou_(function () {
    const db = base_();
    const ligne = trouverLigne_(db.incidents, data.incident_id);
    if (!ligne) throw erreur_('INTROUVABLE', 'Incident introuvable.');
    const inc = depuisLigne_(db.incidents.getRange(ligne, 1, 1, COLS_INCIDENTS.length).getValues()[0], COLS_INCIDENTS);
    if (!sess.isBO && inc.pdv !== sess.profil) throw erreur_('INTERDIT', 'Incident d\'un autre point de vente.');

    const now = new Date().toISOString();
    const action = {
      id: Utilities.getUuid(),
      incident_id: inc.id,
      cree_le: now,
      auteur: sess.profil,
      agent: agent,
      code: code,
      libelle: def.libelle,
      reference: texte_(data.reference, 80),
      commentaire: commentaire,
      statut_apres: def.statut || inc.statut,
    };
    db.actions.appendRow(versLigne_(action, COLS_ACTIONS));

    if (def.statut) {
      inc.statut = def.statut;
      inc.cloture_le = (def.statut === 'TERMINE' || def.statut === 'REJETE') ? now : '';
    }
    inc.derniere_action = def.libelle;
    inc.maj_le = now;
    db.incidents.getRange(ligne, 1, 1, COLS_INCIDENTS.length).setValues([versLigne_(inc, COLS_INCIDENTS)]);
    return { incident: inc, action: action };
  });
}

function valider_(d) {
  const categorie = d.categorie === 'FORMALITE' ? 'FORMALITE' : (d.categorie === 'MOBILE_MONEY' ? 'MOBILE_MONEY' : '');
  if (!categorie) throw erreur_('VALIDATION', 'Catégorie invalide.');
  const inc = {
    declarant: texte_(d.declarant, 80),
    categorie: categorie,
    type_operation: '',
    operateur: texte_(d.operateur, 20).toUpperCase(),
    date_operation: texte_(d.date_operation, 20),
    montant: Math.round(Number(d.montant)),
    telephone: '',
    reference: '',
    incident: '',
    num_liquidation: '',
    formalite: '',
    description: texte_(d.description, 2000),
    solution: texte_(d.solution, 120),
  };
  if (categorie === 'MOBILE_MONEY') {
    inc.type_operation = d.type_operation === 'RETRAIT' ? 'RETRAIT' : (d.type_operation === 'DEPOT' ? 'DEPOT' : '');
    inc.telephone = texte_(d.telephone, 30);
    inc.reference = texte_(d.reference, 80);
    if (!inc.type_operation) throw erreur_('VALIDATION', 'Précisez s\'il s\'agit d\'un dépôt ou d\'un retrait.');
    if (!inc.operateur) throw erreur_('VALIDATION', "Choisissez l'opérateur.");
  } else {
    inc.incident = texte_(d.incident, 120);
    inc.num_liquidation = texte_(d.num_liquidation, 60);
    inc.formalite = texte_(d.formalite, 120);
    if (!inc.incident) throw erreur_('VALIDATION', "Indiquez l'incident survenu.");
    if (!inc.num_liquidation) throw erreur_('VALIDATION', 'Indiquez le numéro de liquidation.');
    if (!inc.formalite) throw erreur_('VALIDATION', 'Indiquez la formalité voulue.');
  }
  if (!/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2})?$/.test(inc.date_operation)) throw erreur_('VALIDATION', "Date de l'opération invalide.");
  if (!(inc.montant > 0)) throw erreur_('VALIDATION', 'Le montant doit être supérieur à 0.');
  if (!inc.description) throw erreur_('VALIDATION', 'Expliquez ce qui s\'est passé.');
  if (!inc.solution) throw erreur_('VALIDATION', 'Choisissez la solution demandée.');
  return inc;
}

/* ------------------------------------------------------------------ */
/* Accès à la feuille                                                  */
/* ------------------------------------------------------------------ */

function base_() {
  const id = PropertiesService.getScriptProperties().getProperty('SHEET_ID');
  const ss = id ? SpreadsheetApp.openById(id) : SpreadsheetApp.getActiveSpreadsheet();
  const incidents = onglet_(ss, 'Incidents', COLS_INCIDENTS);
  const actions = onglet_(ss, 'Actions', COLS_ACTIONS);
  const acces = onglet_(ss, 'Acces', ['profil', 'code']);
  if (acces.getLastRow() < 2) {
    const lignes = [[BACK_OFFICE, '']].concat(POINTS_DE_VENTE.map(function (p) { return [p, '']; }));
    acces.getRange(2, 1, lignes.length, 2).setValues(lignes);
  }
  return { incidents: incidents, actions: actions, acces: acces };
}

function onglet_(ss, nom, cols) {
  let sh = ss.getSheetByName(nom);
  if (!sh) {
    sh = ss.insertSheet(nom);
    sh.getRange(1, 1, 1, cols.length).setValues([cols]).setFontWeight('bold').setBackground('#0D47A1').setFontColor('#FFFFFF');
    sh.setFrozenRows(1);
    // Tout en texte brut (n° de téléphone, de liquidation, dates ISO…), sauf le montant.
    sh.getRange(1, 1, sh.getMaxRows(), cols.length).setNumberFormat('@');
    const iMontant = cols.indexOf('montant');
    if (iMontant >= 0) sh.getRange(2, iMontant + 1, sh.getMaxRows() - 1, 1).setNumberFormat('#,##0');
  }
  return sh;
}

function lire_(sh, cols) {
  const valeurs = sh.getDataRange().getValues();
  return valeurs.slice(1).filter(function (r) { return r[0] !== ''; }).map(function (r) { return depuisLigne_(r, cols); });
}

function depuisLigne_(r, cols) {
  const o = {};
  cols.forEach(function (c, i) {
    let v = r[i];
    if (v instanceof Date) v = v.toISOString();
    o[c] = c === 'montant' ? Number(v) || 0 : (v === null || v === undefined ? '' : String(v));
  });
  return o;
}

function versLigne_(o, cols) {
  return cols.map(function (c) {
    const v = o[c];
    if (c === 'montant') return Number(v) || 0;
    const s = v === null || v === undefined ? '' : String(v);
    // Force le texte : pas de formule (=, +, -, @), pas de conversion des n° (zéros
    // en tête de téléphone, n° de liquidation) ni des dates ISO.
    return /^[=+\-@]/.test(s) || /^[\d\s.,:\/TZ+-]+$/.test(s) ? "'" + s : s;
  });
}

function trouverLigne_(sh, id) {
  if (!id || sh.getLastRow() < 2) return 0;
  const ids = sh.getRange(2, 1, sh.getLastRow() - 1, 1).getValues();
  for (let k = 0; k < ids.length; k++) {
    if (String(ids[k][0]) === String(id)) return k + 2;
  }
  return 0;
}

function prochainId_(sh) {
  const props = PropertiesService.getScriptProperties();
  let seq = Number(props.getProperty('SEQ_INCIDENT'));
  if (!seq) seq = Math.max(0, sh.getLastRow() - 1);
  seq += 1;
  props.setProperty('SEQ_INCIDENT', String(seq));
  return 'INC-' + new Date().getFullYear() + '-' + ('0000' + seq).slice(-5);
}

/* ------------------------------------------------------------------ */
/* Utilitaires                                                         */
/* ------------------------------------------------------------------ */

function verrou_(fn) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    return fn();
  } finally {
    lock.releaseLock();
  }
}

function texte_(v, max) {
  return String(v === null || v === undefined ? '' : v).trim().slice(0, max);
}

function erreur_(code, message) {
  const e = new Error(message);
  e.code = code;
  return e;
}

function json_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}
