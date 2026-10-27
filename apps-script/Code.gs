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
 *   - Acces     : un code d'accès facultatif par point de vente (vide = pas de code).
 *
 * Le Back Office se connecte par code à usage unique (OTP) envoyé par e-mail :
 * seuls les agents de BO_UTILISATEURS peuvent le recevoir.
 */

const BACK_OFFICE = 'BACK OFFICE';

const POINTS_DE_VENTE = [
  'ABOBO', 'ABOISSO', 'AGBOVILLE', 'ANGRE', 'BONDOUKOU', 'BONGOUANOU', 'BOUAKE',
  'BOUNA', 'BOUNDIALI', 'COSMOS', 'DAOUKRO', 'DIMBOKRO', 'DIVO', 'FERKE',
  'FOURRIERE ABOBO', 'FOURRIERE BASSAM', 'GUIGLO', 'KONG', 'MANKONO', 'KATIOLA',
  'ODIENNE', 'PHB', 'SASSANDRA', 'SEGUELA', 'TOUBA', 'SIEGE', 'VGE', 'YOPOUGON',
];

// Agents du Back Office autorisés à recevoir un code de connexion (à garder identique à
// BO_UTILISATEURS dans assets/js/config.js).
const BO_UTILISATEURS = [
  { nom: 'Anne Adjo', poste: 'Opérateur', email: 'anne.niamkoun@cgi.ci' },
  { nom: 'Aminata Sow', poste: 'Assistant', email: 'aminata.sow@cgi.ci' },
  { nom: 'Axel Kouamenan', poste: 'Chef', email: 'axel.kouamenan@cgi.ci' },
  { nom: 'Zeinab Kone', poste: 'Responsable', email: 'zeinab.kone@cgi.ci' },
  { nom: 'Issa Kone', poste: 'Manager', email: 'issa.kone@cgi.ci' },
  { nom: 'Jansenus Koffi', poste: 'Manager', email: 'jansenus.koffi@cgi.ci' },
];
const OTP_SECONDES = 5 * 60;          // validité du code envoyé par e-mail
const OTP_ESSAIS = 5;                 // essais avant invalidation du code
const OTP_DELAI_RENVOI = 45;          // secondes minimum entre deux envois
const SESSION_HEURES = 12;            // durée d'une session Back Office

// À garder identique à ACTIONS_BO dans assets/js/config.js.
const ACTIONS = {
  PRISE_EN_CHARGE: { libelle: 'Prise en charge', statut: 'EN_COURS', bo: true },
  CREATION_CA: { libelle: 'Création de CA', statut: 'EN_COURS', bo: true },
  DEMANDE_REGULARISATION: { libelle: 'Demande de régularisation', statut: 'EN_COURS', bo: true },
  RELANCE: { libelle: 'Relance opérateur', statut: 'EN_COURS', bo: true },
  INFO_PDV: { libelle: "Demande d'information au PDV", statut: 'EN_COURS', bo: true },
  COMMENTAIRE: { libelle: 'Commentaire', statut: null, bo: true },
  TERMINE: { libelle: 'Terminée (résolue)', statut: 'TERMINE', bo: true },
  COMPLEMENT: { libelle: "Complément d'information du PDV", statut: null, bo: false },
};
const COMMENTAIRE_OBLIGATOIRE = ['COMMENTAIRE', 'COMPLEMENT', 'INFO_PDV'];

const COLS_INCIDENTS = [
  'id', 'cree_le', 'pdv', 'declarant', 'categorie', 'type_operation', 'operateur',
  'date_operation', 'montant', 'telephone', 'reference', 'incident', 'num_liquidation',
  'formalite', 'description', 'solution', 'statut', 'derniere_action', 'maj_le', 'cloture_le',
];
const COLS_ACTIONS = [
  'id', 'incident_id', 'cree_le', 'auteur', 'agent', 'code', 'libelle', 'reference',
  'commentaire', 'statut_apres', 'date_envoi',
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
  MailApp.getRemainingDailyQuota(); // demande l'autorisation d'envoyer les codes par e-mail
  Logger.log('Onglets prêts. Déployez maintenant le script en Application Web.');
}

/* ------------------------------------------------------------------ */
/* Routage et authentification                                         */
/* ------------------------------------------------------------------ */

function route_(req) {
  // Connexion du Back Office par code à usage unique : avant toute authentification.
  if (req.action === 'otpSend') return envoyerOtp_(req.email);
  if (req.action === 'otpVerify') return verifierOtp_(req.email, req.otp);
  if (req.action === 'logout') { if (req.token) props_().deleteProperty(cleJeton_(req.token)); return { ok: true }; }

  const sess = auth_(req.profil, req.code, req.token);
  switch (req.action) {
    case 'login':
      return { ok: true, profil: sess.profil, isBO: sess.isBO, user: sess.user || null };
    case 'list':
      return Object.assign({ ok: true }, lister_(sess));
    case 'checkLiquidation':
      return Object.assign({ ok: true }, chercherLiquidation_(req.num));
    case 'create':
      return { ok: true, incident: creer_(sess, req.data || {}) };
    case 'addAction':
      return Object.assign({ ok: true }, ajouterAction_(sess, req.data || {}));
    default:
      throw erreur_('ACTION_INCONNUE', 'Action inconnue.');
  }
}

function auth_(profil, code, token) {
  const p = String(profil || '').trim().toUpperCase();
  if (!p) throw erreur_('PROFIL_INCONNU', 'Profil manquant.');
  if (p === BACK_OFFICE) {
    const user = lireJeton_(token);
    if (!user) throw erreur_('SESSION_EXPIREE', 'Session Back Office expirée, reconnectez-vous.');
    return { profil: p, isBO: true, user: user, agent: user.nom };
  }
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
/* Connexion Back Office : code à usage unique par e-mail              */
/* ------------------------------------------------------------------ */

function agentBo_(email) {
  const e = String(email || '').trim().toLowerCase();
  const u = BO_UTILISATEURS.find(function (x) { return x.email.toLowerCase() === e; });
  if (!u) throw erreur_('AGENT_INCONNU', "Cet agent n'est pas autorisé au Back Office.");
  return u;
}

function envoyerOtp_(email) {
  const u = agentBo_(email);
  const cache = CacheService.getScriptCache();
  const k = u.email.toLowerCase();
  if (cache.get('OTPW_' + k)) throw erreur_('OTP_TROP_TOT', "Un code vient d'être envoyé. Patientez quelques secondes avant d'en demander un autre.");
  // Tirage à partir d'un UUID (aléa cryptographique), plutôt que Math.random.
  const code = ('000000' + (parseInt(hash_(Utilities.getUuid()).slice(0, 12), 16) % 1e6)).slice(-6);
  cache.put('OTP_' + k, JSON.stringify({ h: hash_(code), n: 0 }), OTP_SECONDES);
  cache.put('OTPW_' + k, '1', OTP_DELAI_RENVOI);
  const minutes = Math.round(OTP_SECONDES / 60);
  MailApp.sendEmail({
    to: u.email,
    name: 'Suivi des incidents PDV',
    subject: 'Votre code de connexion : ' + code,
    body: 'Bonjour ' + u.nom + ',\n\nVotre code de connexion au Back Office est : ' + code +
      '\nIl est valable ' + minutes + " minutes.\n\nSi vous n'êtes pas à l'origine de cette demande, ignorez ce message.",
    htmlBody:
      '<div style="font-family:Segoe UI,Arial,sans-serif;max-width:460px;margin:auto;padding:28px;border:1px solid #e3e8f0;border-radius:16px">' +
      '<p style="margin:0 0 6px;color:#64748b;font-size:12px;letter-spacing:.08em;text-transform:uppercase;font-weight:700">Back Office · Incidents de paiement</p>' +
      '<h2 style="margin:0 0 16px;color:#0d1526">Bonjour ' + u.nom + ',</h2>' +
      '<p style="color:#334155;margin:0 0 18px">Voici votre code de connexion :</p>' +
      '<p style="font-size:34px;letter-spacing:10px;font-weight:800;color:#1d4ed8;background:#e8efff;border-radius:12px;padding:14px 0;text-align:center;margin:0 0 18px">' + code + '</p>' +
      '<p style="color:#64748b;font-size:13px;margin:0">Valable <b>' + minutes + " minutes</b>, utilisable une seule fois. Si vous n'êtes pas à l'origine de cette demande, ignorez ce message.</p></div>",
  });
  return { ok: true, email: u.email, expire: OTP_SECONDES };
}

function verifierOtp_(email, otp) {
  const u = agentBo_(email);
  const cache = CacheService.getScriptCache();
  const k = u.email.toLowerCase();
  const brut = cache.get('OTP_' + k);
  if (!brut) throw erreur_('OTP_EXPIRE', 'Code expiré ou inexistant. Demandez un nouveau code.');
  const o = JSON.parse(brut);
  if (o.h !== hash_(String(otp || '').trim())) {
    o.n += 1;
    if (o.n >= OTP_ESSAIS) {
      cache.remove('OTP_' + k);
      throw erreur_('OTP_EXPIRE', "Trop d'essais incorrects. Demandez un nouveau code.");
    }
    cache.put('OTP_' + k, JSON.stringify(o), OTP_SECONDES);
    throw erreur_('OTP_INVALIDE', 'Code incorrect (' + (OTP_ESSAIS - o.n) + ' essai(s) restant(s)).');
  }
  cache.remove('OTP_' + k);
  nettoyerJetons_();
  const token = Utilities.getUuid() + Utilities.getUuid();
  const user = { nom: u.nom, poste: u.poste, email: u.email };
  props_().setProperty(cleJeton_(token), JSON.stringify({ u: user, exp: Date.now() + SESSION_HEURES * 36e5 }));
  return { ok: true, token: token, profil: BACK_OFFICE, isBO: true, user: user };
}

function lireJeton_(token) {
  if (!token) return null;
  const brut = props_().getProperty(cleJeton_(token));
  if (!brut) return null;
  const t = JSON.parse(brut);
  if (t.exp < Date.now()) { props_().deleteProperty(cleJeton_(token)); return null; }
  // Un agent retiré de la liste perd l'accès immédiatement.
  const actif = BO_UTILISATEURS.some(function (x) { return x.email.toLowerCase() === t.u.email.toLowerCase(); });
  return actif ? t.u : null;
}

function nettoyerJetons_() {
  const p = props_();
  const tout = p.getProperties();
  Object.keys(tout).forEach(function (k) {
    if (k.indexOf('TOK_') !== 0) return;
    try { if (JSON.parse(tout[k]).exp < Date.now()) p.deleteProperty(k); } catch (e) { p.deleteProperty(k); }
  });
}

function cleJeton_(token) { return 'TOK_' + hash_(token); }
function props_() { return PropertiesService.getScriptProperties(); }

function hash_(s) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(s), Utilities.Charset.UTF_8)
    .map(function (b) { return ('0' + (b & 255).toString(16)).slice(-2); }).join('');
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
    // Une liquidation correspond à un seul paiement : contrôle sur tous les points de vente.
    if (inc.num_liquidation) {
      const cle = cleLiquidation_(inc.num_liquidation);
      const deja = lire_(db.incidents, COLS_INCIDENTS).find(function (i) { return i.num_liquidation && cleLiquidation_(i.num_liquidation) === cle; });
      if (deja) throw erreur_('DOUBLON_LIQUIDATION', 'Le n° de liquidation ' + inc.num_liquidation + ' a déjà été déclaré (' + deja.id + ', ' + deja.pdv + ').');
    }
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
  // La prise en charge se fait sans commentaire.
  const commentaire = code === 'PRISE_EN_CHARGE' ? '' : texte_(data.commentaire, 2000);
  if (COMMENTAIRE_OBLIGATOIRE.indexOf(code) >= 0 && !commentaire) {
    throw erreur_('VALIDATION', 'Un commentaire est obligatoire pour cette action.');
  }
  // N° du CA obligatoire ; pour une régularisation, objet et date d'envoi du mail à Alima.
  const reference = texte_(data.reference, 200);
  let dateEnvoi = '';
  if (code === 'CREATION_CA' && !reference) throw erreur_('VALIDATION', 'Indiquez le N° du CA.');
  if (code === 'DEMANDE_REGULARISATION') {
    dateEnvoi = texte_(data.date_envoi, 10);
    if (!reference) throw erreur_('VALIDATION', "Indiquez l'objet du mail envoyé à Alima.");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateEnvoi)) throw erreur_('VALIDATION', "Indiquez la date d'envoi du mail.");
  }
  // Un point de vente agit en son nom ; l'agent Back Office est celui de la session.
  const agent = sess.agent || texte_(data.agent, 80) || (sess.isBO ? '' : sess.profil);
  if (!agent) throw erreur_('VALIDATION', "Indiquez le nom de l'agent.");

  return verrou_(function () {
    const db = base_();
    const ligne = trouverLigne_(db.incidents, data.incident_id);
    if (!ligne) throw erreur_('INTROUVABLE', 'Incident introuvable.');
    const inc = depuisLigne_(db.incidents.getRange(ligne, 1, 1, COLS_INCIDENTS.length).getValues()[0], COLS_INCIDENTS);
    if (!sess.isBO && inc.pdv !== sess.profil) throw erreur_('INTERDIT', 'Incident d\'un autre point de vente.');
    // Le Back Office prend d'abord l'incident en charge (sans commentaire), puis seulement les autres actions.
    if (inc.statut === 'TERMINE' || inc.statut === 'REJETE') throw erreur_('CLOTURE', 'Incident clôturé : plus aucune action ne peut être ajoutée.');
    if (sess.isBO && inc.statut === 'NOUVEAU' && code !== 'PRISE_EN_CHARGE') throw erreur_('PRISE_EN_CHARGE_REQUISE', "Prenez d'abord l'incident en charge.");
    if (code === 'PRISE_EN_CHARGE' && inc.statut !== 'NOUVEAU') throw erreur_('DEJA_PRIS', 'Cet incident est déjà pris en charge.');

    const now = new Date().toISOString();
    const action = {
      id: Utilities.getUuid(),
      incident_id: inc.id,
      cree_le: now,
      auteur: sess.profil,
      agent: agent,
      code: code,
      libelle: def.libelle,
      reference: reference,
      commentaire: commentaire,
      statut_apres: def.statut || inc.statut,
      date_envoi: dateEnvoi,
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
    if (!inc.operateur) throw erreur_('VALIDATION', 'Choisissez le moyen de paiement.');
  } else {
    inc.incident = texte_(d.incident, 120);
    inc.num_liquidation = texte_(d.num_liquidation, 60);
    inc.formalite = texte_(d.formalite, 120);
    if (!inc.incident) throw erreur_('VALIDATION', "Indiquez l'incident survenu.");
    if (!inc.num_liquidation) throw erreur_('VALIDATION', 'Indiquez le numéro de liquidation.');
    inc.num_liquidation = inc.num_liquidation.toUpperCase().replace(/\s+/g, '');
    if (!/^LIQ-\d{1,15}$/.test(inc.num_liquidation)) throw erreur_('VALIDATION', 'Le n° de liquidation doit être au format LIQ- suivi de 15 chiffres au maximum.');
    if (!inc.formalite) throw erreur_('VALIDATION', 'Indiquez la formalité voulue.');
    if (!inc.operateur) throw erreur_('VALIDATION', 'Choisissez le moyen de paiement.');
  }
  if (!/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2})?$/.test(inc.date_operation)) throw erreur_('VALIDATION', "Date de l'opération invalide.");
  if (!(inc.montant > 0)) throw erreur_('VALIDATION', 'Le montant doit être supérieur à 0.');
  if (!inc.description) throw erreur_('VALIDATION', 'Expliquez ce qui s\'est passé.');
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
  } else if (sh.getLastColumn() < cols.length) {
    const debut = sh.getLastColumn() + 1;
    const manquantes = cols.slice(debut - 1);
    sh.getRange(1, debut, 1, manquantes.length).setValues([manquantes]).setFontWeight('bold').setBackground('#0D47A1').setFontColor('#FFFFFF');
    sh.getRange(1, debut, sh.getMaxRows(), manquantes.length).setNumberFormat('@');
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

/** Liquidation déjà déclarée, tous points de vente confondus : seuls le n° d'incident et le PDV sont renvoyés. */
function chercherLiquidation_(num) {
  const cle = cleLiquidation_(num);
  if (!cle) return { existe: false };
  const deja = lire_(base_().incidents, COLS_INCIDENTS).find(function (i) { return i.num_liquidation && cleLiquidation_(i.num_liquidation) === cle; });
  return deja ? { existe: true, id: deja.id, pdv: deja.pdv } : { existe: false };
}

function cleLiquidation_(v) {
  return String(v || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
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
