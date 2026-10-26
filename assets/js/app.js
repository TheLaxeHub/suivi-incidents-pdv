/*
 * Suivi des incidents de paiement — interface.
 *
 * Point de vente : Accueil (déclarer, répondre au Back Office, dernières nouvelles), Mes déclarations, Statistiques.
 * Back Office    : File de traitement (à prendre en charge → en traitement → attente PDV → clôturés),
 *                  Pilotage, Registre complet, Synthèse par PDV.
 * Un incident s'ouvre dans un panneau latéral avec son suivi, l'étape suivante proposée et la saisie d'action.
 */
(function () {
  'use strict';
  const C = window.APP_CONFIG;
  const Store = window.Store;
  const BO = C.BACK_OFFICE;

  // État affiché : « ATTENTE » est un « EN_COURS » dont la dernière action est une demande d'information au PDV.
  const ETATS = {
    NOUVEAU: { libelle: 'Nouveau', pluriel: 'Nouveaux', var: '--new' },
    EN_COURS: { libelle: 'En traitement', pluriel: 'En traitement', var: '--prog' },
    ATTENTE: { libelle: 'Attente PDV', libellePdv: 'Réponse attendue', pluriel: 'En attente du PDV', var: '--wait' },
    TERMINE: { libelle: 'Résolu', pluriel: 'Résolus', var: '--done' },
    REJETE: { libelle: 'Rejeté', pluriel: 'Rejetés', var: '--rej' },
  };
  const ORDRE = ['NOUVEAU', 'EN_COURS', 'ATTENTE', 'TERMINE', 'REJETE'];
  const NATURES = {
    DEPOT: { libelle: 'Dépôt', ico: 'arrow-down-to-line' },
    RETRAIT: { libelle: 'Retrait', ico: 'arrow-up-from-line' },
    FORMALITE: { libelle: 'Formalité', ico: 'file-text' },
  };
  const ICO_ACTION = {
    DECLARATION: 'send', PRISE_EN_CHARGE: 'hand', CREATION_CA: 'file-plus-2', DEMANDE_REGULARISATION: 'refresh-ccw',
    RELANCE: 'phone-outgoing', INFO_PDV: 'message-circle-question', COMMENTAIRE: 'message-square',
    TERMINE: 'circle-check', REJETE: 'circle-x', COMPLEMENT: 'reply',
  };
  const AVEC_REFERENCE = ['CREATION_CA', 'DEMANDE_REGULARISATION', 'RELANCE'];
  // Libellé et exemple du champ « référence » selon l'action.
  const CHAMPS_REFERENCE = {
    CREATION_CA: ['N° du CA *', 'Ex. : CA-24589'],
    DEMANDE_REGULARISATION: ['Objet du mail envoyé à Alima *', 'Ex. : Régularisation INC-2026-00012 – ABOBO'],
    RELANCE: ['Référence (facultatif)', 'N° de ticket chez l\'opérateur…'],
  };
  const COURTS_ACTION = {
    PRISE_EN_CHARGE: 'Prise en charge', CREATION_CA: 'Création CA', DEMANDE_REGULARISATION: 'Régularisation', RELANCE: 'Relance opérateur',
    INFO_PDV: 'Info au PDV', COMMENTAIRE: 'Commentaire', TERMINE: 'Résolue', REJETE: 'Rejetée',
  };
  const MODELES = {
    DEPOT: ["Notre compte a été débité mais le client n'a pas reçu l'argent.", 'Dépôt envoyé sur un mauvais numéro.', "Transaction restée en attente chez l'opérateur."],
    RETRAIT: ["Le client a validé le retrait mais notre compte n'a pas été crédité.", 'Le client a été débité deux fois.', "Retrait en échec mais le client a été débité."],
    FORMALITE: ["L'usager a payé mais le paiement est resté en attente, non confirmé.", 'Le montant débité ne correspond pas à la formalité.', "L'usager a été débité deux fois."],
  };
  const PAR_PAGE = 50;
  const CLE_SESSION = 'sip_session';

  const VUES = {
    pdv: [
      { id: 'accueil', libelle: 'Accueil', ico: 'house', desc: 'Déclarez un incident et suivez les réponses du Back Office.' },
      { id: 'suivi', libelle: 'Mes déclarations', ico: 'list-checks', desc: 'Toutes vos déclarations et leur avancement.' },
      { id: 'stats', libelle: 'Statistiques', ico: 'chart-column', desc: 'Les indicateurs de vos incidents sur la période choisie.' },
    ],
    bo: [
      { id: 'file', libelle: 'File de traitement', court: 'File', ico: 'inbox', desc: 'Les incidents à prendre en charge et à traiter.' },
      { id: 'pilotage', libelle: 'Pilotage', ico: 'layout-dashboard', desc: 'Les indicateurs de tous les points de vente.' },
      { id: 'registre', libelle: 'Registre', ico: 'table', desc: 'Tous les incidents, triables, filtrables et exportables.' },
      { id: 'pdv', libelle: 'Synthèse par PDV', court: 'PDV', ico: 'store', desc: 'La situation de chaque point de vente.' },
    ],
  };
  // Anciennes ancres de la version précédente.
  const ANCRES = { 'sec-kpi': 'pilotage', 'sec-reg': 'registre', 'sec-synth': 'pdv', 'sec-alertes': 'file' };

  const S = {
    session: null,
    incidents: [],
    actions: [],
    meta: {},
    vue: '',
    ouvert: null,
    contexte: [],
    charts: {},
    synchro: null,
    minuteur: null,
    vus: {},
    vusBase: '',
    file: { lane: '', q: '', pdv: '', nature: '', op: '', tri: 'ancien' },
    suivi: { tab: 'ouverts', q: '' },
    reg: { q: '', pdv: '', nature: '', op: '', etat: '', tri: 'cree_le', sens: -1, limite: PAR_PAGE },
    per: { periode: '30j', du: '', au: '', pdv: '' },
    lignesExport: [],
  };

  /* ================= Utilitaires ================= */

  const $ = function (s, r) { return (r || document).querySelector(s); };
  const $$ = function (s, r) { return Array.from((r || document).querySelectorAll(s)); };
  const esc = function (s) {
    return String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  };
  const nf = new Intl.NumberFormat('fr-FR');
  // Espace insécable classique : l'espace fine de fr-FR n'existe pas dans toutes les polices.
  const nombre = function (n) { return nf.format(Math.round(Number(n) || 0)).replace(/ /g, ' '); };
  const fcfa = function (n) { return nombre(n) + ' FCFA'; };
  const compact = function (n) {
    n = Number(n) || 0;
    if (n >= 1e6) return (n / 1e6).toLocaleString('fr-FR', { maximumFractionDigits: 1 }) + ' M';
    if (n >= 1e4) return Math.round(n / 1e3) + ' k';
    return nombre(n);
  };
  const p2 = function (n) { return String(n).padStart(2, '0'); };
  const date = function (v) { if (!v) return null; const d = v instanceof Date ? v : new Date(v); return isNaN(d) ? null : d; };
  const fDate = function (v) { const d = date(v); return d ? p2(d.getDate()) + '/' + p2(d.getMonth() + 1) + '/' + d.getFullYear() : '—'; };
  const fHeure = function (v) { const d = date(v); return d ? p2(d.getHours()) + ':' + p2(d.getMinutes()) : ''; };
  const fDateHeure = function (v) { const d = date(v); return d ? fDate(d) + ' ' + fHeure(d) : '—'; };
  // Date de l'opération : jour seul pour les nouvelles déclarations, avec l'heure pour les anciennes.
  const fDateOp = function (v) { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(v || '')); return m ? m[3] + '/' + m[2] + '/' + m[1] : fDateHeure(v); };
  const cleJour = function (d) { return d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate()); };
  const heuresDepuis = function (v) { const d = date(v); return d ? (Date.now() - d) / 36e5 : 0; };
  const duree = function (h) {
    if (h === null || h === undefined || isNaN(h)) return '—';
    if (h < 1) return Math.max(1, Math.round(h * 60)) + ' min';
    if (h < 48) return Math.round(h) + ' h';
    return Math.round(h / 24) + ' j';
  };
  const ilya = function (v) {
    const h = heuresDepuis(v);
    if (h < 1 / 60) return "à l'instant";
    return 'il y a ' + duree(h);
  };
  const quand = function (v) {
    const d = date(v);
    if (!d) return '—';
    const auj = cleJour(new Date());
    const hier = cleJour(new Date(Date.now() - 864e5));
    if (cleJour(d) === auj) return "aujourd'hui " + fHeure(d);
    if (cleJour(d) === hier) return 'hier ' + fHeure(d);
    return fDate(d) + ' ' + fHeure(d);
  };
  const sansAccents = function (s) { return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase(); };
  const nature = function (i) { return i.categorie === 'FORMALITE' ? 'FORMALITE' : i.type_operation; };
  const operateur = function (code) {
    if (!code) return null;
    return C.OPERATEURS.find(function (o) { return o.code === code; }) || { code: code, nom: code, couleur: '#94a3b8' };
  };
  const estBO = function () { return !!(S.session && S.session.isBO); };
  const moi = function () { return S.session ? S.session.profil : ''; };
  const parId = function (id) { return S.incidents.find(function (i) { return i.id === id; }); };
  const actionsDe = function (id) {
    return S.actions.filter(function (a) { return a.incident_id === id; })
      .sort(function (a, b) { return String(a.cree_le).localeCompare(String(b.cree_le)); });
  };
  const estOuvert = function (i) { return i.statut === 'NOUVEAU' || i.statut === 'EN_COURS'; };
  const etat = function (i) { return i.statut === 'EN_COURS' && S.meta[i.id] && S.meta[i.id].attente ? 'ATTENTE' : i.statut; };
  const cssVar = function (v) { return getComputedStyle(document.documentElement).getPropertyValue(v).trim() || '#888'; };
  const ico = function (nom, cls) { return '<i data-lucide="' + nom + '"' + (cls ? ' class="' + cls + '"' : '') + '></i>'; };
  function icones() { if (window.lucide) window.lucide.createIcons(); }

  const libelleEtat = function (e) { const d = ETATS[e] || ETATS.NOUVEAU; return !estBO() && d.libellePdv ? d.libellePdv : d.libelle; };
  const badge = function (e) { return '<span class="badge s-' + e + '">' + libelleEtat(e) + '</span>'; };
  const logoOp = function (o) {
    return '<span class="op-l" style="background:' + esc(o.couleur) + '">' + esc(o.nom.replace(/[^A-Za-z]/g, '').slice(0, 2).toUpperCase()) + '</span>';
  };
  const pastilleOp = function (code) {
    const o = operateur(code);
    return o ? '<span class="op">' + logoOp(o) + esc(o.nom) + '</span>' : '<span class="z">—</span>';
  };
  const icoNature = function (i) {
    const n = NATURES[nature(i)] || NATURES.DEPOT;
    return '<span class="nat-i n-' + nature(i) + '" title="' + n.libelle + '">' + ico(n.ico) + '</span>';
  };
  const sousTitre = function (i) {
    const n = NATURES[nature(i)] || NATURES.DEPOT;
    const op = operateur(i.operateur);
    if (i.categorie === 'FORMALITE') return n.libelle + ' · ' + (i.incident || 'incident');
    return n.libelle + (op ? ' · ' + op.nom : '');
  };
  const reference = function (i) { return i.categorie === 'FORMALITE' ? i.num_liquidation : i.reference; };
  const declarePar = function (i) { return i.declarant && i.declarant !== i.pdv ? i.declarant + ' — ' + i.pdv : i.pdv; };

  const memoire = {
    lire: function (k) { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } },
    ecrire: function (k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* mode privé */ } },
    effacer: function (k) { try { localStorage.removeItem(k); } catch (e) { /* mode privé */ } },
  };
  const cle = function (nom) { return 'sip_' + nom + '_' + moi(); };

  function toast(msg, type) {
    const t = document.createElement('div');
    t.className = 'toast ' + (type || '');
    t.innerHTML = (type === 'ok' ? ico('circle-check') : type === 'err' ? ico('circle-alert') : ico('info')) + '<span>' + esc(msg) + '</span>';
    $('#toasts').appendChild(t);
    icones();
    setTimeout(function () { t.classList.add('out'); setTimeout(function () { t.remove(); }, 220); }, type === 'err' ? 5500 : 3200);
  }
  function chargement(on) { $('#loader').hidden = !on; }
  function copier(texte) {
    const ok = function () { toast('Copié : ' + texte, 'ok'); };
    if (navigator.clipboard) navigator.clipboard.writeText(texte).then(ok, function () { toast('Copie impossible.', 'err'); });
  }

  /* ================= Dérivés : état de suivi, non-lus ================= */

  function calculerMeta() {
    const m = {};
    S.incidents.forEach(function (i) { m[i.id] = { attente: false, reponse: false, derniere: null, pec: null, traitement: null, question: null }; });
    S.actions.slice().sort(function (a, b) { return String(a.cree_le).localeCompare(String(b.cree_le)); }).forEach(function (a) {
      const x = m[a.incident_id];
      if (!x) return;
      x.derniere = a;
      if (a.auteur === BO && !x.pec && a.code !== 'COMMENTAIRE') x.pec = a.cree_le;
      if (a.auteur === BO && !x.traitement && a.code !== 'COMMENTAIRE' && a.code !== 'PRISE_EN_CHARGE' && a.code !== 'INFO_PDV') x.traitement = a.cree_le;
      if (a.code === 'INFO_PDV') { x.attente = true; x.reponse = false; x.question = a; } else if (a.code === 'COMPLEMENT') { x.attente = false; x.reponse = true; } else if (a.code !== 'COMMENTAIRE') { x.attente = false; x.reponse = false; }
    });
    S.meta = m;
  }

  // Étape de suivi (1 déclaré, 2 pris en charge, 3 en traitement, 4 clôturé).
  function etape(i) {
    if (!estOuvert(i)) return 4;
    const m = S.meta[i.id] || {};
    if (m.traitement) return 3;
    if (i.statut !== 'NOUVEAU' || m.pec) return 2;
    return 1;
  }

  // « Non lu » : quelque chose a bougé côté de l'autre partie depuis la dernière ouverture de l'incident.
  function nonLu(i) {
    const m = S.meta[i.id] || {};
    const vu = S.vus[i.id] || S.vusBase;
    if (m.derniere) return m.derniere.auteur !== moi() && String(m.derniere.cree_le) > vu;
    return estBO() && String(i.cree_le) > vu;
  }
  function marquerVu(id) {
    S.vus[id] = new Date().toISOString();
    memoire.ecrire(cle('vus'), S.vus);
  }

  /* ================= Connexion ================= */

  let profilChoisi = null;

  function initConnexion() {
    $$('[data-cfg]').forEach(function (el) { el.textContent = C[el.dataset.cfg] || ''; });
    document.title = C.APP_TITRE + ' — QFS';
    $('#lgConf').hidden = Store.configure;
    dessinerGrille('');
    dessinerAgents();
    $('#lgUsers').addEventListener('click', function (e) {
      const b = e.target.closest('[data-email]');
      if (b) demanderOtp(b.dataset.email, b);
    });
    $('#lgOtpBack').addEventListener('click', function () { etapeConnexion(1); role('bo'); });
    $('#lgOtp').addEventListener('submit', function (e) { e.preventDefault(); validerOtp(); });
    $('#otpRe').addEventListener('click', function () { demanderOtp(otp.email, null, true); });
    initSaisieOtp();
    $('#lgSearch').addEventListener('input', function (e) { dessinerGrille(e.target.value); });
    $('#lgSearch').addEventListener('keydown', function (e) {
      if (e.key !== 'Enter') return;
      const premier = $('#lgGrid .lg-pdv');
      if (premier) premier.click();
    });
    $('#lgGrid').addEventListener('click', function (e) {
      const b = e.target.closest('[data-pdv]');
      if (b) choisirProfil(b.dataset.pdv);
    });
    $('#lgRecent').addEventListener('click', function (e) {
      const b = e.target.closest('[data-pdv]');
      if (b) choisirProfil(b.dataset.pdv);
    });
    $$('.lg-role button').forEach(function (b) {
      b.addEventListener('click', function () { role(b.dataset.role); });
    });
    $('#lgBack').addEventListener('click', function () { etapeConnexion(1); });
    $('#lgEye').addEventListener('click', function () {
      const c = $('#lgCode');
      c.type = c.type === 'password' ? 'text' : 'password';
      $('#lgEye').innerHTML = ico(c.type === 'password' ? 'eye' : 'eye-off');
      icones();
    });
    $('#lgStep2').addEventListener('submit', function (e) {
      e.preventDefault();
      connecter(profilChoisi, $('#lgCode').value.trim());
    });
  }

  function role(r) {
    $$('.lg-role button').forEach(function (b) { b.classList.toggle('on', b.dataset.role === r); });
    $('#lgPdvPane').hidden = r !== 'pdv';
    $('#lgBoPane').hidden = r !== 'bo';
    if (r === 'pdv') setTimeout(function () { $('#lgSearch').focus(); }, 30);
  }

  function dessinerGrille(q) {
    const n = sansAccents(q).trim();
    const pdvs = C.POINTS_DE_VENTE.filter(function (p) { return !n || sansAccents(p).includes(n); });
    $('#lgGrid').innerHTML = pdvs.length
      ? pdvs.map(function (p) {
        return '<button type="button" class="lg-pdv" data-pdv="' + esc(p) + '" title="' + esc(p) + '"><span class="lg-pin">' + esc(p.charAt(0)) + '</span>' + esc(p) + '</button>';
      }).join('')
      : '<div class="lg-none">Aucun point de vente ne correspond.</div>';
  }

  const initiales = function (nom) { return nom.split(/\s+/).map(function (m) { return m.charAt(0); }).join('').slice(0, 2).toUpperCase(); };
  const masquerEmail = function (e) { const m = e.split('@'); return m[0].slice(0, 2) + '•••' + m[0].slice(-1) + '@' + m[1]; };

  function dessinerAgents() {
    $('#lgUsers').innerHTML = (C.BO_UTILISATEURS || []).map(function (u, k) {
      return '<button type="button" class="lg-user" data-email="' + esc(u.email) + '" style="--k:' + k + '">' +
        '<span class="av av-u">' + esc(initiales(u.nom)) + '</span>' +
        '<span class="lg-user-t"><b>' + esc(u.nom) + '</b><small>' + esc(u.email) + '</small></span>' +
        '<span class="lg-poste">' + esc(u.poste) + '</span>' + ico('arrow-right', 'lg-user-a') + '</button>';
    }).join('');
  }

  /* Connexion du Back Office par code à usage unique reçu par e-mail. */
  const otp = { email: '', fin: 0, duree: 1, renvoi: 0, minuteur: null };

  async function demanderOtp(email, bouton, renvoi) {
    const u = (C.BO_UTILISATEURS || []).find(function (x) { return x.email === email; });
    if (!u) return;
    erreurConnexion('');
    if (bouton) bouton.classList.add('busy');
    chargement(true);
    try {
      const r = await Store.otpEnvoyer(email);
      otp.email = email;
      otp.duree = (r.expire || C.OTP_MINUTES * 60) * 1000;
      otp.fin = Date.now() + otp.duree;
      otp.renvoi = Date.now() + 45000;
      etapeConnexion(3);
      $('#otpMail').textContent = masquerEmail(u.email);
      $('#otpNom').textContent = u.nom;
      $('#otpPoste').textContent = u.poste + ' · Back Office';
      $('#otpAv').textContent = initiales(u.nom);
      $('#otpDemo').hidden = !r.demoCode;
      $('#otpDemo').innerHTML = r.demoCode ? ico('flask-conical') + '<span>Mode démonstration — votre code : <b class="mono">' + esc(r.demoCode) + '</b></span>' : '';
      viderOtp();
      clearInterval(otp.minuteur);
      otp.minuteur = setInterval(tickOtp, 250);
      tickOtp();
      icones();
      if (renvoi) toast('Nouveau code envoyé à ' + masquerEmail(u.email), 'ok');
    } catch (err) {
      erreurConnexion(err.message);
    } finally {
      if (bouton) bouton.classList.remove('busy');
      chargement(false);
    }
  }

  function arreterOtp() { clearInterval(otp.minuteur); otp.minuteur = null; }

  function tickOtp() {
    const reste = Math.max(0, otp.fin - Date.now());
    const sec = Math.ceil(reste / 1000);
    $('#otpTime').textContent = Math.floor(sec / 60) + ':' + p2(sec % 60);
    $('#otpArc').style.strokeDashoffset = String(119.4 * (1 - reste / otp.duree));
    $('#otpRing').classList.toggle('low', sec <= 60);
    $('#otpRing').classList.toggle('off', !reste);
    $('#otpGo').disabled = !reste;
    const attente = Math.ceil((otp.renvoi - Date.now()) / 1000);
    $('#otpRe').disabled = reste > 0 && attente > 0;
    $('#otpReTxt').textContent = !reste ? 'Code expiré.' : attente > 0 ? 'Renvoi possible dans ' + attente + ' s.' : 'Pas reçu ?';
    if (!reste) arreterOtp();
  }

  const casesOtp = function () { return $$('#otpIn input'); };
  function viderOtp() {
    casesOtp().forEach(function (c) { c.value = ''; c.classList.remove('err'); });
    setTimeout(function () { casesOtp()[0].focus(); }, 60);
  }
  function codeOtp() { return casesOtp().map(function (c) { return c.value; }).join(''); }

  function initSaisieOtp() {
    const cases = casesOtp();
    const remplir = function (depart, chiffres) {
      chiffres.split('').forEach(function (ch, k) { if (cases[depart + k]) cases[depart + k].value = ch; });
      cases[Math.min(cases.length - 1, depart + chiffres.length)].focus();
      if (codeOtp().length === cases.length) validerOtp();
    };
    cases.forEach(function (c, k) {
      c.addEventListener('input', function () {
        const v = c.value.replace(/\D/g, '');
        c.value = '';
        cases.forEach(function (x) { x.classList.remove('err'); });
        if (v) remplir(k, v.slice(0, cases.length - k));
      });
      c.addEventListener('keydown', function (e) {
        if (e.key === 'Backspace' && !c.value && cases[k - 1]) { cases[k - 1].value = ''; cases[k - 1].focus(); e.preventDefault(); }
        if (e.key === 'ArrowLeft' && cases[k - 1]) cases[k - 1].focus();
        if (e.key === 'ArrowRight' && cases[k + 1]) cases[k + 1].focus();
      });
      c.addEventListener('paste', function (e) {
        const v = ((e.clipboardData || window.clipboardData).getData('text') || '').replace(/\D/g, '');
        if (!v) return;
        e.preventDefault();
        remplir(0, v.slice(0, cases.length));
      });
      c.addEventListener('focus', function () { c.select(); });
    });
  }

  let otpEnCours = false;
  async function validerOtp() {
    const code = codeOtp();
    if (otpEnCours) return;
    if (code.length !== 6) { erreurConnexion('Saisissez les 6 chiffres du code reçu.'); return; }
    if (Date.now() >= otp.fin) { erreurConnexion('Code expiré. Demandez un nouveau code.'); return; }
    otpEnCours = true;
    $('#otpGo').disabled = true;
    chargement(true);
    erreurConnexion('');
    try {
      const r = await Store.otpVerifier(otp.email, code);
      arreterOtp();
      demarrerSession({ profil: BO, code: '', token: r.token, user: r.user, isBO: true });
      toast('Bienvenue ' + r.user.nom, 'ok');
    } catch (err) {
      erreurConnexion(err.message);
      casesOtp().forEach(function (c) { c.classList.add('err'); });
      if (err.code === 'OTP_EXPIRE') { otp.fin = Date.now(); tickOtp(); } else { viderOtp(); }
    } finally {
      otpEnCours = false;
      $('#otpGo').disabled = Date.now() >= otp.fin;
      chargement(false);
    }
  }

  function erreurConnexion(msg) {
    $('#lgErr').hidden = !msg;
    $('#lgErr').innerHTML = msg ? ico('circle-alert') + '<span>' + esc(msg) + '</span>' : '';
    icones();
  }

  function etapeConnexion(n) {
    $('#lgStep1').hidden = n !== 1 || !Store.configure;
    $('#lgStep2').hidden = n !== 2;
    $('#lgOtp').hidden = n !== 3;
    if (n !== 3) arreterOtp();
    erreurConnexion('');
    if (n === 2) {
      const bo = profilChoisi === BO;
      $('#lgWho').textContent = bo ? 'Back Office' : profilChoisi;
      $('#lgAv').textContent = bo ? 'BO' : profilChoisi.charAt(0);
      $('#lgAv').className = 'av av-lg' + (bo ? ' bo' : '');
      $('#lgCode').value = '';
      setTimeout(function () { $('#lgCode').focus(); }, 50);
    }
  }

  function choisirProfil(profil) {
    profilChoisi = profil;
    connecter(profil, '');
  }

  async function connecter(profil, code, silencieux, token) {
    chargement(true);
    erreurConnexion('');
    try {
      const r = await Store.login({ profil: profil, code: code, token: token });
      demarrerSession({ profil: r.profil || profil, code: code, token: token || '', user: r.user || null, isBO: (r.profil || profil) === BO });
    } catch (err) {
      if (silencieux) { afficherConnexion(); return; }
      if (err.code === 'CODE_REQUIS') {
        etapeConnexion(2);
      } else {
        if (err.code === 'CODE_INVALIDE') etapeConnexion(2);
        erreurConnexion(err.message);
      }
    } finally {
      chargement(false);
    }
  }

  function afficherConnexion() {
    $('#app').hidden = true;
    $('#login').hidden = false;
    document.body.className = '';
    etapeConnexion(1);
    $('#lgSearch').value = '';
    dessinerGrille('');
    const dernier = memoire.lire('sip_dernier_profil');
    role(dernier === BO ? 'bo' : 'pdv');
    $('#lgRecent').hidden = !dernier || dernier === BO;
    if (dernier && dernier !== BO) {
      $('#lgRecent').innerHTML = '<button type="button" data-pdv="' + esc(dernier) + '"><span class="av">' + esc(dernier.charAt(0)) + '</span><span class="grow"><small>Continuer en tant que</small><b>' + esc(dernier) + '</b></span>' + ico('arrow-right') + '</button>';
    }
    icones();
  }

  function demarrerSession(sess) {
    S.session = sess;
    memoire.ecrire(CLE_SESSION, { profil: sess.profil, code: sess.code, token: sess.token || '', user: sess.user || null });
    memoire.ecrire('sip_dernier_profil', sess.profil);
    S.vus = memoire.lire(cle('vus')) || {};
    S.vusBase = memoire.lire(cle('vus_base'));
    if (sess.user) memoire.ecrire(cle('agent'), sess.user.nom);
    if (!S.vusBase) { S.vusBase = new Date().toISOString(); memoire.ecrire(cle('vus_base'), S.vusBase); }
    document.body.className = sess.isBO ? 'is-bo' : 'is-pdv';
    $('#login').hidden = true;
    $('#app').hidden = false;
    initApp();
    S.premier = true;
    router();
    actualiser();
    clearInterval(S.minuteur);
    if (C.ACTUALISATION_SECONDES > 0) {
      S.minuteur = setInterval(function () {
        if (!document.hidden && $('#mNew').hidden) actualiser(true);
      }, C.ACTUALISATION_SECONDES * 1000);
    }
  }

  function deconnecter(message) {
    clearInterval(S.minuteur);
    fermerDeclaration();
    fermerPanneau();
    if (S.session && S.session.token && !message && Store.logout) Store.logout(S.session);
    memoire.effacer(CLE_SESSION);
    S.session = null;
    S.incidents = [];
    S.actions = [];
    S.meta = {};
    detruireGraphiques();
    $('#view').innerHTML = '';
    history.replaceState(null, '', location.pathname + location.search);
    afficherConnexion();
    window.scrollTo(0, 0);
    toast(message || 'Vous êtes déconnecté.', message ? 'err' : 'ok');
  }

  /* ================= Coque de l'application ================= */

  let appInitialisee = false;

  function vues() { return estBO() ? VUES.bo : VUES.pdv; }

  function initApp() {
    const bo = estBO();
    const u = S.session.user;
    $('#sbAv').textContent = bo ? (u ? initiales(u.nom) : 'BO') : moi().charAt(0);
    $('#sbAv').className = 'av' + (bo ? ' bo' : '');
    $('#sbName').textContent = bo ? (u ? u.nom : 'Back Office') : moi();
    $('#sbRole').textContent = bo ? (u ? u.email : C.POINTS_DE_VENTE.length + ' points de vente') : 'Point de vente';
    $('#sbRole').title = bo && u ? u.poste + ' · Back Office' : '';
    $('#topEyebrow').textContent = bo ? 'Back Office' : 'Point de Vente';
    $('#phPill').textContent = bo ? (u ? u.nom : 'Back Office') : moi();
    $('#demoBar').hidden = !Store.demo;
    // Menu à la manière d'iris : groupe « E - Money », entrée dépliable, sous-menu à trait vertical.
    $('#sbNav').innerHTML = '<p class="sb-lbl">E - Money</p><div class="sb-grp open">' +
      '<button type="button" class="sb-par on" data-grp aria-expanded="true">' + ico(bo ? 'radio' : 'house') + '<span>' + (bo ? 'Back Office' : 'Point de Vente') + '</span>' + ico('chevron-down', 'sb-chev') + '</button>' +
      '<div class="sb-sub">' + vues().map(function (v) {
        return '<a href="#/' + v.id + '" class="sb-a" data-vue="' + v.id + '">' + ico(v.ico) + v.libelle + '<span class="cnt" data-cnt="' + v.id + '" hidden></span></a>';
      }).join('') + '</div></div>';
    $('#tabbar').innerHTML = vues().map(function (v) {
      return '<a href="#/' + v.id + '" data-vue="' + v.id + '">' + ico(v.ico) + (v.court || v.libelle.replace('Mes déclarations', 'Suivi')) + '<span class="cnt" data-cnt="' + v.id + '" hidden></span></a>';
    }).join('');
    majTheme();
    icones();

    if (appInitialisee) return;
    appInitialisee = true;

    window.addEventListener('hashchange', function () { if (S.session) router(); });
    $('#sbNav').addEventListener('click', function (e) {
      const b = e.target.closest('[data-grp]');
      if (!b) return;
      const g = b.parentElement;
      g.classList.toggle('open');
      b.setAttribute('aria-expanded', g.classList.contains('open') ? 'true' : 'false');
    });
    document.addEventListener('click', clicGlobal);
    document.addEventListener('keydown', clavier);
    $('#btnRefresh').addEventListener('click', function () { actualiser(); });
    $('#btnLogout').addEventListener('click', function () { deconnecter(); });
    $('#btnTheme').addEventListener('click', basculerTheme);
    $('#btnSearch').addEventListener('click', ouvrirRecherche);
    $('#ov').addEventListener('click', fermerPanneau);
    $('#pClose').addEventListener('click', fermerPanneau);
    $('#pPrev').addEventListener('click', function () { voisin(-1); });
    $('#pNext').addEventListener('click', function () { voisin(1); });
    $('#pCopy').addEventListener('click', function () {
      const url = location.href.split('#')[0] + '#/' + S.vue + '?i=' + encodeURIComponent(S.ouvert);
      if (navigator.clipboard) navigator.clipboard.writeText(url).then(function () { toast('Lien de l\'incident copié', 'ok'); });
    });
    $('#view').addEventListener('input', saisieVue);
    $('#view').addEventListener('change', saisieVue);
    initRecherche();
    initDeclaration();
    setInterval(majSynchro, 20000);
  }

  function clicGlobal(e) {
    const t = e.target;
    const nouveau = t.closest('[data-new]');
    if (nouveau && S.session) { ouvrirDeclaration(nouveau.dataset.new || ''); return; }
    const cp = t.closest('[data-copy]');
    if (cp) { e.stopPropagation(); copier(cp.dataset.copy); return; }
    const q = t.closest('[data-quick]');
    if (q) { e.stopPropagation(); actionRapide(q.dataset.id, q.dataset.quick, contexteDe(q.closest('[data-open]'))); return; }
    const ouv = t.closest('[data-open]');
    if (ouv && !t.closest('#pnl')) { ouvrirPanneau(ouv.dataset.open, contexteDe(ouv)); return; }
    const act = t.closest('[data-act]');
    if (act && $('#view').contains(act)) actionVue(act);
  }

  function contexteDe(el) {
    const liste = el.closest('[data-liste]');
    return liste ? $$('[data-open]', liste).map(function (x) { return x.dataset.open; }) : [el.dataset.open];
  }

  function enSaisie(e) {
    const t = e.target;
    return t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
  }

  function clavier(e) {
    if (!S.session) return;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); ouvrirRecherche(); return; }
    if (e.key === 'Escape') {
      if (!$('#cmdk').hidden) fermerRecherche();
      else if (!$('#mNew').hidden) fermerDeclaration();
      else if (S.ouvert) fermerPanneau();
      return;
    }
    if (enSaisie(e) || e.ctrlKey || e.metaKey || e.altKey || !$('#mNew').hidden || !$('#cmdk').hidden) return;
    if (e.key === '/') { e.preventDefault(); ouvrirRecherche(); }
    else if ((e.key === 'n' || e.key === 'N') && !estBO()) { e.preventDefault(); ouvrirDeclaration(''); }
    else if (S.ouvert && e.key === 'j') { e.preventDefault(); voisin(1); }
    else if (S.ouvert && e.key === 'k') { e.preventDefault(); voisin(-1); }
  }

  /* Thème */
  function themeActuel() {
    const t = document.documentElement.dataset.theme;
    if (t) return t;
    return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  function majTheme() { $('#btnTheme').innerHTML = ico(themeActuel() === 'dark' ? 'sun' : 'moon'); icones(); }
  function basculerTheme() {
    const t = themeActuel() === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = t;
    try { localStorage.setItem('sip_theme', t); } catch (e) { /* mode privé */ }
    majTheme();
    rendre();
  }

  /* Synchronisation */
  function majSynchro(etatSync) {
    const b = $('#btnRefresh');
    if (etatSync) b.className = 'sync ' + etatSync;
    $('#tbSync').textContent = S.synchro ? 'Mis à jour ' + ilya(S.synchro) : '—';
    b.title = S.synchro ? 'Données du ' + fDateHeure(S.synchro) + ' — cliquer pour actualiser' : 'Actualiser';
  }

  async function actualiser(silencieux) {
    if (!silencieux && !S.premier) chargement(true);
    majSynchro('busy');
    const avant = { ids: {}, actions: S.actions.length };
    S.incidents.forEach(function (i) { avant.ids[i.id] = true; });
    const avaitDonnees = S.synchro !== null;
    try {
      const r = await Store.list(S.session);
      S.incidents = r.incidents || [];
      S.actions = r.actions || [];
      S.synchro = new Date();
      calculerMeta();
      if (avaitDonnees && silencieux) signalerNouveautes(avant);
      S.premier = false;
      router();
      majSynchro('');
    } catch (err) {
      majSynchro('off');
      if (err.code === 'CODE_INVALIDE' || err.code === 'CODE_REQUIS' || err.code === 'PROFIL_INCONNU' || err.code === 'SESSION_EXPIREE') {
        deconnecter('Session expirée : ' + err.message);
      } else if (!silencieux) {
        toast(err.message, 'err');
      }
    } finally {
      chargement(false);
    }
  }

  function signalerNouveautes(avant) {
    const nouveaux = S.incidents.filter(function (i) { return !avant.ids[i.id]; });
    if (estBO() && nouveaux.length) toast(nouveaux.length + ' nouvel(s) incident(s) déclaré(s)', 'ok');
    const reponses = S.actions.length - avant.actions;
    if (!estBO() && reponses > 0) toast('Le Back Office a mis à jour vos déclarations', 'ok');
  }

  /* ================= Routage ================= */

  function lireHash() {
    const h = location.hash.replace(/^#\/?/, '');
    if (ANCRES[h]) { history.replaceState(null, '', '#/' + ANCRES[h]); return { vue: ANCRES[h], id: null }; }
    const m = h.split('?');
    const p = new URLSearchParams(m[1] || '');
    return { vue: m[0], id: p.get('i') };
  }

  function router() {
    const r = lireHash();
    const ok = vues().some(function (v) { return v.id === r.vue; });
    const vue = ok ? r.vue : vues()[0].id;
    if (!ok) { history.replaceState(null, '', '#/' + vue + (r.id ? '?i=' + encodeURIComponent(r.id) : '')); }
    if (vue !== S.vue) {
      if (S.vue && S.ouvert && !r.id) {
        S.ouvert = null;
        $('#ov').classList.remove('on');
        $('#pnl').classList.remove('on');
        $('#pnl').setAttribute('aria-hidden', 'true');
      }
      S.vue = vue;
      window.scrollTo(0, 0);
    }
    rendre();
    if (r.id && r.id !== S.ouvert && parId(r.id)) ouvrirPanneau(r.id);
    else if (S.ouvert) rendrePanneau();
  }

  function aller(vue) { location.hash = '#/' + vue; }

  /* ================= Rendu général ================= */

  function detruireGraphiques() {
    Object.keys(S.charts).forEach(function (k) { S.charts[k].destroy(); });
    S.charts = {};
  }

  function rendre() {
    if (!S.session) return;
    const v = vues().find(function (x) { return x.id === S.vue; }) || vues()[0];
    $('#topTitle').textContent = v.libelle;
    $('#phTitle').textContent = v.libelle;
    $('#phSub').textContent = v.desc || '';
    $('#phIco').innerHTML = ico(v.ico);
    document.title = (compteurs().total ? '(' + compteurs().total + ') ' : '') + v.libelle + ' — ' + C.APP_TITRE;
    $$('[data-vue]').forEach(function (a) { a.classList.toggle('on', a.dataset.vue === v.id); });
    majCompteurs();

    // On garde le focus et la position du curseur dans la recherche lors d'un nouveau rendu.
    const actif = document.activeElement;
    const focusId = actif && $('#view').contains(actif) ? actif.id : null;
    const curseur = focusId && actif.selectionStart !== undefined ? actif.selectionStart : null;

    detruireGraphiques();
    const vuesRendu = { accueil: vueAccueil, suivi: vueSuivi, stats: vuePilotage, file: vueFile, pilotage: vuePilotage, registre: vueRegistre, pdv: vueSynthese };
    if (S.premier) $('#view').innerHTML = squelette();
    else {
      $('#view').innerHTML = vuesRendu[v.id]() + '<footer class="ft">Quipux Financial Services — ' + esc(C.APP_TITRE) + ' · ' + new Date().getFullYear() + '</footer>';
      apresRendu[v.id] && apresRendu[v.id]();
    }
    icones();
    if (focusId && $('#' + focusId)) {
      const el = $('#' + focusId);
      el.focus();
      if (curseur !== null) try { el.setSelectionRange(curseur, curseur); } catch (e) { /* champ sans sélection */ }
    }
  }

  const apresRendu = {
    stats: function () { graphiquesPilotage(); },
    pilotage: function () { graphiquesPilotage(); },
  };

  function squelette() {
    const b = function (h) { return '<div class="skel" style="height:' + h + 'px"></div>'; };
    return '<div class="kg">' + b(110) + b(110) + b(110) + b(110) + '</div>' + b(56) + b(380);
  }

  function compteurs() {
    const c = { file: 0, accueil: 0, total: 0 };
    if (!S.session) return c;
    if (estBO()) {
      c.file = S.incidents.filter(function (i) { return i.statut === 'NOUVEAU' || (S.meta[i.id] || {}).reponse; }).length;
      c.total = c.file;
    } else {
      c.accueil = S.incidents.filter(function (i) { return etat(i) === 'ATTENTE' || nonLu(i); }).length;
      c.total = c.accueil;
    }
    return c;
  }

  function majCompteurs() {
    const c = compteurs();
    $$('[data-cnt]').forEach(function (el) {
      const n = c[el.dataset.cnt] || 0;
      el.hidden = !n;
      el.textContent = n;
      el.classList.toggle('hot', n > 0);
    });
  }

  // Champs des vues : chaque champ porte data-f="objet.cle".
  function saisieVue(e) {
    const el = e.target.closest('[data-f]');
    if (!el) return;
    if (e.type === 'input' && el.tagName === 'SELECT') return;
    if (e.type === 'change' && el.type === 'search') return;
    const parts = el.dataset.f.split('.');
    S[parts[0]][parts[1]] = el.value;
    if (parts[0] === 'reg') S.reg.limite = PAR_PAGE;
    rendre();
  }

  function actionVue(el) {
    const a = el.dataset.act;
    const v = el.dataset.v;
    if (a === 'lane') { S.file.lane = v; rendre(); }
    else if (a === 'tab') { S.suivi.tab = v; rendre(); }
    else if (a === 'periode') { S.per.periode = v; rendre(); }
    else if (a === 'raz') {
      const o = S[v];
      Object.keys(o).forEach(function (k) { if (['q', 'pdv', 'nature', 'op', 'etat'].indexOf(k) >= 0) o[k] = ''; });
      rendre();
    } else if (a === 'unset') { const p = v.split('.'); S[p[0]][p[1]] = ''; rendre(); }
    else if (a === 'tri') {
      if (S.reg.tri === v) S.reg.sens = -S.reg.sens; else { S.reg.tri = v; S.reg.sens = v === 'pdv' ? 1 : -1; }
      rendre();
    } else if (a === 'plus') { S.reg.limite += PAR_PAGE; rendre(); }
    else if (a === 'xlsx') exporterExcel();
    else if (a === 'print') window.print();
    else if (a === 'voir-pdv') {
      Object.assign(S.reg, { pdv: v, q: '', nature: '', op: '', etat: '', limite: PAR_PAGE });
      aller('registre');
    } else if (a === 'voir-etat') {
      if (estBO()) { S.file.lane = v; aller('file'); } else { S.suivi.tab = v === 'clos' ? 'clos' : 'ouverts'; aller('suivi'); }
    } else if (a === 'aller') aller(v);
  }

  /* ================= Filtres communs ================= */

  function bornes(per) {
    const f = per || S.per;
    const now = new Date();
    const jour = function (d) { return new Date(d.getFullYear(), d.getMonth(), d.getDate()); };
    let du = null;
    let au = null;
    switch (f.periode) {
      case 'jour': du = jour(now); break;
      case '7j': du = jour(new Date(now - 6 * 864e5)); break;
      case '30j': du = jour(new Date(now - 29 * 864e5)); break;
      case '90j': du = jour(new Date(now - 89 * 864e5)); break;
      case 'mois': du = new Date(now.getFullYear(), now.getMonth(), 1); break;
      case 'perso':
        if (f.du) du = new Date(f.du + 'T00:00');
        if (f.au) { au = new Date(f.au + 'T00:00'); au.setDate(au.getDate() + 1); }
        break;
      default: break;
    }
    return { du: du, au: au };
  }

  // Période précédente de même durée, pour les comparaisons.
  function bornesPrecedentes() {
    const b = bornes();
    if (!b.du) return null;
    const fin = b.au || new Date();
    const len = fin - b.du;
    return { du: new Date(b.du - len), au: b.du };
  }

  function libellePeriode() {
    const b = bornes();
    if (!b.du && !b.au) return 'Toute la période';
    const fin = b.au ? new Date(b.au - 864e5) : new Date();
    if (b.du && cleJour(b.du) === cleJour(fin)) return 'le ' + fDate(b.du);
    return (b.du ? 'du ' + fDate(b.du) : "jusqu'") + ' au ' + fDate(fin);
  }

  function dansPeriode(liste, b, pdv) {
    return liste.filter(function (i) {
      const d = date(i.cree_le);
      if (b.du && d < b.du) return false;
      if (b.au && d >= b.au) return false;
      if (pdv && i.pdv !== pdv) return false;
      return true;
    });
  }

  function rechercher(liste, q) {
    const n = sansAccents(q).trim();
    if (!n) return liste;
    const mots = n.split(/\s+/);
    return liste.filter(function (i) {
      const t = sansAccents([i.id, i.pdv, i.reference, i.num_liquidation, i.telephone, i.description, i.formalite, i.incident, i.declarant, i.solution, i.montant, (operateur(i.operateur) || {}).nom, NATURES[nature(i)] ? NATURES[nature(i)].libelle : ''].join(' '));
      return mots.every(function (m) { return t.includes(m); });
    });
  }

  function stats(liste) {
    const s = { n: liste.length, montant: 0, montantOuvert: 0, delais: [], delaisPec: [] };
    ORDRE.forEach(function (k) { s[k] = 0; });
    liste.forEach(function (i) {
      const m = Number(i.montant) || 0;
      s.montant += m;
      s[etat(i)] += 1;
      if (estOuvert(i)) s.montantOuvert += m;
      if (i.statut === 'TERMINE' && i.cloture_le) s.delais.push((date(i.cloture_le) - date(i.cree_le)) / 36e5);
      const pec = (S.meta[i.id] || {}).pec;
      if (pec) s.delaisPec.push((date(pec) - date(i.cree_le)) / 36e5);
    });
    s.ouverts = s.NOUVEAU + s.EN_COURS + s.ATTENTE;
    s.traites = s.TERMINE + s.REJETE;
    s.taux = s.n ? Math.round((s.traites / s.n) * 100) : 0;
    const moy = function (t) { return t.length ? t.reduce(function (a, b) { return a + b; }, 0) / t.length : null; };
    s.delaiMoyen = moy(s.delais);
    s.delaiPec = moy(s.delaisPec);
    s.retard = liste.filter(function (i) { return i.statut === 'NOUVEAU' && heuresDepuis(i.cree_le) >= C.SEUIL_ALERTE_HEURES; }).length;
    return s;
  }

  /* ================= Éléments réutilisables ================= */

  function tagAge(i) {
    if (!estOuvert(i)) return '<span class="tag">' + ico('lock') + 'clos ' + quand(i.cloture_le || i.maj_le).replace(/ \d\d:\d\d$/, '') + '</span>';
    const h = heuresDepuis(i.cree_le);
    const seuil = C.SEUIL_ALERTE_HEURES;
    const cls = i.statut === 'NOUVEAU' ? (h >= seuil ? ' hot' : h >= seuil / 2 ? ' warm' : '') : '';
    return '<span class="tag' + cls + '" title="Déclaré le ' + fDateHeure(i.cree_le) + '">' + ico('clock') + duree(h) + '</span>';
  }

  function carte(i, opts) {
    opts = opts || {};
    const m = S.meta[i.id] || {};
    const e = etat(i);
    const lu = !nonLu(i);
    const tags = [];
    if (estBO() && m.reponse && estOuvert(i)) tags.push('<span class="tag info">' + ico('reply') + 'Réponse du PDV</span>');
    if (estOuvert(i) && Number(i.montant) >= C.SEUIL_MONTANT_ELEVE) tags.push('<span class="tag warm" title="Montant élevé">' + ico('banknote') + '</span>');
    const derniere = m.derniere;
    const titre = estBO()
      ? '<b>' + esc(i.pdv) + '</b><span class="z">·</span><span class="tt">' + esc(sousTitre(i)) + '</span>'
      : '<span class="tt">' + esc(sousTitre(i)) + '</span>';
    const ref = reference(i);
    const rapide = opts.rapide && i.statut === 'NOUVEAU'
      ? '<button type="button" class="btn bo btn-sm" data-quick="PRISE_EN_CHARGE" data-id="' + esc(i.id) + '">' + ico('hand') + 'Prendre en charge</button>'
      : '';
    return '<div class="ic' + (lu ? '' : ' unread') + (S.ouvert === i.id ? ' sel' : '') + '" role="button" tabindex="0" data-open="' + esc(i.id) + '">' +
      icoNature(i) +
      '<div class="ic-main"><div class="ic-t">' + titre + '</div>' +
      '<div class="ic-m"><span class="ic-id">' + esc(i.id) + '</span><span class="sep"></span>' + quand(i.date_operation) +
      (ref ? '<span class="sep ic-ref"></span><span class="mono ic-ref">' + esc(ref) + '</span>' : '') + '</div></div>' +
      '<div class="ic-last"><b>' + esc(derniere ? derniere.libelle : 'Déclaration') + '</b>' + ilya(derniere ? derniere.cree_le : i.cree_le) + '</div>' +
      '<div class="ic-amt">' + nombre(i.montant) + '<small>FCFA</small></div>' +
      '<div class="ic-r">' + tags.join('') + (opts.mini ? mini(i) : badge(e)) + tagAge(i) + rapide + '</div>' +
      '</div>';
  }

  function mini(i) {
    const k = etape(i);
    const couleur = 'var(' + ETATS[etat(i)].var + ')';
    let h = '<span class="mini" style="--kc:' + couleur + '" title="' + libelleEtat(etat(i)) + '">';
    for (let s = 1; s <= 4; s++) h += '<span' + (s <= k ? ' class="on"' : '') + '></span>';
    return h + '</span>' + badge(etat(i));
  }

  function liste(items, opts, vide) {
    if (!items.length) {
      return '<div class="empty"><span class="em-i">' + ico(vide.ico || 'inbox') + '</span><b>' + vide.titre + '</b>' + (vide.texte || '') + '</div>';
    }
    const limite = opts.limite || items.length;
    return '<div class="ilist" data-liste>' + items.slice(0, limite).map(function (i) { return carte(i, opts); }).join('') + '</div>' +
      (items.length > limite ? '<div class="more"><button type="button" class="btn bo btn-sm" data-act="aller" data-v="' + (opts.plus || 'registre') + '">Voir les ' + items.length + ' incidents' + ico('arrow-right') + '</button></div>' : '');
  }

  function kpi(o) {
    const tag = o.act ? 'button type="button" data-act="' + o.act + '" data-v="' + (o.v || '') + '"' : 'div';
    return '<' + tag + ' class="kc' + (o.on ? ' on' : '') + '" style="--kc:var(' + o.c + ')">' +
      '<div class="kc-h"><span class="kc-i">' + ico(o.ico) + '</span>' + o.l + '</div>' +
      '<div class="kc-v">' + o.val + (o.u ? '<small>' + o.u + '</small>' : '') + '</div>' +
      '<div class="kc-s">' + (o.s || '&nbsp;') + '</div></' + (o.act ? 'button' : 'div') + '>';
  }

  // Variation par rapport à la période précédente ; « inverse » quand une hausse est une bonne nouvelle.
  function variation(actuel, avant, inverse) {
    if (avant === null || avant === undefined) return '';
    if (!avant && !actuel) return '<span class="dl flat">=</span>';
    if (!avant) return '<span class="dl ' + (inverse ? 'good' : 'up') + '">' + ico('trending-up') + 'nouveau</span>';
    const p = Math.round(((actuel - avant) / avant) * 100);
    if (p === 0) return '<span class="dl flat">= </span>';
    const hausse = p > 0;
    const cls = inverse ? (hausse ? 'good' : 'bad') : (hausse ? 'up' : 'down');
    return '<span class="dl ' + cls + '">' + (hausse ? '+' : '') + p + ' %</span>';
  }

  function selectPdv(champ, valeur) {
    return '<select class="in in-sm" id="sel-' + champ.replace('.', '-') + '" data-f="' + champ + '" aria-label="Point de vente"><option value="">Tous les PDV</option>' +
      C.POINTS_DE_VENTE.map(function (p) { return '<option' + (p === valeur ? ' selected' : '') + '>' + esc(p) + '</option>'; }).join('') + '</select>';
  }
  function selectNature(champ, valeur) {
    return '<select class="in in-sm" id="sel-' + champ.replace('.', '-') + '" data-f="' + champ + '" aria-label="Nature"><option value="">Toutes natures</option>' +
      Object.keys(NATURES).map(function (n) { return '<option value="' + n + '"' + (n === valeur ? ' selected' : '') + '>' + NATURES[n].libelle + '</option>'; }).join('') + '</select>';
  }
  function selectOp(champ, valeur) {
    return '<select class="in in-sm" id="sel-' + champ.replace('.', '-') + '" data-f="' + champ + '" aria-label="Moyen de paiement"><option value="">Tous moyens de paiement</option>' +
      C.OPERATEURS.map(function (o) { return '<option value="' + esc(o.code) + '"' + (o.code === valeur ? ' selected' : '') + '>' + esc(o.nom) + '</option>'; }).join('') + '</select>';
  }
  function recherche(champ, valeur, ph) {
    return '<div class="sbx">' + ico('search', 'si') + '<input type="search" id="q-' + champ.replace('.', '-') + '" data-f="' + champ + '" value="' + esc(valeur) + '" placeholder="' + (ph || 'Rechercher…') + '" autocomplete="off"></div>';
  }
  function filtresActifs(obj, nom) {
    const libs = { pdv: function (v) { return v; }, nature: function (v) { return NATURES[v].libelle; }, op: function (v) { return operateur(v).nom; }, etat: function (v) { return ETATS[v].pluriel; } };
    const chips = Object.keys(libs).filter(function (k) { return obj[k]; }).map(function (k) {
      return '<button type="button" class="fchip" data-act="unset" data-v="' + nom + '.' + k + '">' + esc(libs[k](obj[k])) + ico('x') + '</button>';
    });
    return chips.length ? '<div class="fchips">' + chips.join('') + (chips.length > 1 ? '<button type="button" class="lnk" data-act="raz" data-v="' + nom + '">Tout effacer</button>' : '') + '</div>' : '';
  }
  function filtrerChamps(items, f) {
    return items.filter(function (i) {
      if (f.pdv && i.pdv !== f.pdv) return false;
      if (f.nature && nature(i) !== f.nature) return false;
      if (f.op && i.operateur !== f.op) return false;
      if (f.etat && etat(i) !== f.etat) return false;
      return true;
    });
  }

  function segPeriode() {
    const opts = [['7j', '7 jours'], ['30j', '30 jours'], ['90j', '90 jours'], ['mois', 'Ce mois'], ['tout', 'Tout'], ['perso', 'Dates…']];
    return '<div class="seg">' + opts.map(function (o) {
      return '<button type="button" data-act="periode" data-v="' + o[0] + '"' + (S.per.periode === o[0] ? ' class="on"' : '') + '>' + o[1] + '</button>';
    }).join('') + '</div>' +
      (S.per.periode === 'perso' ? '<div class="dates"><input type="date" class="in" id="per-du" data-f="per.du" value="' + esc(S.per.du) + '" aria-label="Du"><span class="z">→</span><input type="date" class="in" id="per-au" data-f="per.au" value="' + esc(S.per.au) + '" aria-label="Au"></div>' : '');
  }

  /* ================= Vue PDV : Accueil ================= */

  function vueAccueil() {
    const mes = S.incidents;
    const attente = mes.filter(function (i) { return etat(i) === 'ATTENTE'; });
    const st = stats(mes);
    const st30 = stats(dansPeriode(mes, bornes({ periode: '30j' })));
    const recents = mes.slice().sort(function (a, b) { return String(b.maj_le || b.cree_le).localeCompare(String(a.maj_le || a.cree_le)); });
    const heure = new Date().getHours();
    const salut = heure < 13 ? 'Bonjour' : heure < 18 ? 'Bon après-midi' : 'Bonsoir';
    const nonLus = mes.filter(nonLu).length;

    return '<section class="hero">' +
      '<div><h2>' + salut + ', ' + esc(moi()) + '</h2><p>' +
      (st.ouverts ? st.ouverts + ' incident(s) en cours de traitement pour ' + fcfa(st.montantOuvert) + '.' : 'Aucun incident en cours. Tout est en ordre.') +
      '</p><p class="hero-hint">Un problème avec un paiement ? Choisissez son type pour le déclarer :</p></div>' +
      '<div class="hero-q">' +
      '<button type="button" data-new="DEPOT"><span class="hi">' + ico('arrow-down-to-line') + '</span><span>Dépôt<small>Mobile Money</small></span></button>' +
      '<button type="button" data-new="RETRAIT"><span class="hi">' + ico('arrow-up-from-line') + '</span><span>Retrait<small>Mobile Money</small></span></button>' +
      '<button type="button" data-new="FORMALITE"><span class="hi">' + ico('file-text') + '</span><span>Formalité<small>Débit, liquidation…</small></span></button>' +
      '</div></section>' +

      (attente.length ? '<section class="attn"><div class="sh"><h2 class="sh-t">' + ico('message-circle-question') + 'Le Back Office attend votre réponse <span class="cnt">' + attente.length + '</span></h2><span class="sh-r">Répondez pour débloquer le traitement</span></div>' +
        '<div class="card">' + liste(attente, { mini: true }, {}) + '</div></section>' : '') +

      '<section class="kg">' +
      kpi({ ico: 'inbox', l: 'En attente de prise en charge', val: nombre(st.NOUVEAU), c: '--new', s: st.retard ? '<span class="dl bad">' + st.retard + ' depuis plus de ' + C.SEUIL_ALERTE_HEURES + ' h</span>' : 'pas encore ouverts par le Back Office', act: 'voir-etat', v: 'ouverts' }) +
      kpi({ ico: 'loader', l: 'En traitement', val: nombre(st.EN_COURS + st.ATTENTE), c: '--prog', s: st.ATTENTE ? st.ATTENTE + ' en attente de votre réponse' : 'CA, régularisation, relance…', act: 'voir-etat', v: 'ouverts' }) +
      kpi({ ico: 'circle-check', l: 'Résolus sur 30 jours', val: nombre(st30.TERMINE), c: '--done', s: st30.delaiMoyen !== null ? 'en ' + duree(st30.delaiMoyen) + ' en moyenne' : '—', act: 'voir-etat', v: 'clos' }) +
      kpi({ ico: 'wallet', l: 'Montant en attente', val: compact(st.montantOuvert), u: 'FCFA', c: '--accent', s: 'sur ' + st.ouverts + ' incident(s) ouvert(s)' }) +
      '</section>' +

      '<section><div class="sh"><h2 class="sh-t">' + ico('bell') + 'Dernières nouvelles' + (nonLus ? ' <span class="cnt">' + nonLus + ' non lue(s)</span>' : '') + '</h2><a href="#/suivi" class="lnk">Toutes mes déclarations ' + ico('arrow-right') + '</a></div>' +
      '<div class="card">' + liste(recents, { mini: true, limite: 6, plus: 'suivi' }, { ico: 'sparkles', titre: 'Aucune déclaration pour le moment', texte: 'Vos incidents et leur suivi apparaîtront ici.' }) + '</div></section>';
  }

  /* ================= Vue PDV : Mes déclarations ================= */

  function vueSuivi() {
    const f = S.suivi;
    let items = rechercher(S.incidents, f.q);
    const n = { ouverts: items.filter(estOuvert).length, clos: items.filter(function (i) { return !estOuvert(i); }).length, tous: items.length };
    if (f.tab === 'ouverts') items = items.filter(estOuvert);
    if (f.tab === 'clos') items = items.filter(function (i) { return !estOuvert(i); });
    items = items.slice().sort(function (a, b) {
      if (f.tab === 'ouverts') {
        const pa = etat(a) === 'ATTENTE' ? 0 : 1;
        const pb = etat(b) === 'ATTENTE' ? 0 : 1;
        if (pa !== pb) return pa - pb;
      }
      return String(b.cree_le).localeCompare(String(a.cree_le));
    });
    S.lignesExport = items;
    const tabs = [['ouverts', 'En cours'], ['clos', 'Clôturés'], ['tous', 'Tous']];
    return '<div class="toolbar">' +
      '<div class="seg">' + tabs.map(function (t) { return '<button type="button" data-act="tab" data-v="' + t[0] + '"' + (f.tab === t[0] ? ' class="on"' : '') + '>' + t[1] + '<i>' + n[t[0]] + '</i></button>'; }).join('') + '</div>' +
      recherche('suivi.q', f.q, 'N°, référence, téléphone, montant…') +
      '<span class="grow"></span><button type="button" class="btn bo btn-sm" data-act="xlsx">' + ico('file-spreadsheet') + 'Excel</button>' +
      '</div>' +
      '<div class="card">' + liste(items, { mini: true }, f.q
        ? { ico: 'search-x', titre: 'Aucun résultat', texte: 'Essayez avec un autre n° ou une autre référence.' }
        : { ico: f.tab === 'ouverts' ? 'party-popper' : 'inbox', titre: f.tab === 'ouverts' ? 'Aucun incident en cours' : 'Aucune déclaration', texte: '<p style="margin-top:12px"><button type="button" class="btn bp btn-sm" data-new>' + ico('plus') + 'Déclarer un incident</button></p>' }) + '</div>';
  }

  /* ================= Vue BO : File de traitement ================= */

  function vueFile() {
    const f = S.file;
    const base = filtrerChamps(rechercher(S.incidents, f.q), f);
    const il7 = Date.now() - 7 * 864e5;
    const lanes = {
      NOUVEAU: base.filter(function (i) { return i.statut === 'NOUVEAU'; }),
      EN_COURS: base.filter(function (i) { return etat(i) === 'EN_COURS'; }),
      ATTENTE: base.filter(function (i) { return etat(i) === 'ATTENTE'; }),
      CLOS: base.filter(function (i) { return !estOuvert(i) && date(i.cloture_le || i.maj_le) >= il7; }),
    };
    if (!f.lane) f.lane = lanes.NOUVEAU.length ? 'NOUVEAU' : 'EN_COURS';
    const retard = lanes.NOUVEAU.filter(function (i) { return heuresDepuis(i.cree_le) >= C.SEUIL_ALERTE_HEURES; }).length;
    const reponses = lanes.EN_COURS.filter(function (i) { return (S.meta[i.id] || {}).reponse; }).length;
    const montant = function (l) { return l.reduce(function (s, i) { return s + (Number(i.montant) || 0); }, 0); };
    const defs = [
      { k: 'NOUVEAU', t: 'À prendre en charge', ico: 'inbox', c: '--new', s: retard ? '<b>' + retard + ' en retard</b> (&gt; ' + C.SEUIL_ALERTE_HEURES + ' h)' : compact(montant(lanes.NOUVEAU)) + ' FCFA' },
      { k: 'EN_COURS', t: 'En traitement', ico: 'loader', c: '--prog', s: reponses ? reponses + ' réponse(s) du PDV à lire' : compact(montant(lanes.EN_COURS)) + ' FCFA' },
      { k: 'ATTENTE', t: 'En attente du PDV', ico: 'message-circle-question', c: '--wait', s: 'information demandée' },
      { k: 'CLOS', t: 'Clôturés (7 j)', ico: 'circle-check', c: '--done', s: lanes.CLOS.filter(function (i) { return i.statut === 'TERMINE'; }).length + ' résolus · ' + lanes.CLOS.filter(function (i) { return i.statut === 'REJETE'; }).length + ' rejetés' },
    ];
    const tris = {
      ancien: function (a, b) { return String(a.cree_le).localeCompare(String(b.cree_le)); },
      recent: function (a, b) { return String(b.cree_le).localeCompare(String(a.cree_le)); },
      montant: function (a, b) { return (Number(b.montant) || 0) - (Number(a.montant) || 0); },
      maj: function (a, b) { return String(b.maj_le).localeCompare(String(a.maj_le)); },
    };
    let items = lanes[f.lane].slice();
    if (f.lane === 'EN_COURS') {
      // Les réponses des PDV remontent en tête.
      items.sort(function (a, b) { return ((S.meta[b.id] || {}).reponse ? 1 : 0) - ((S.meta[a.id] || {}).reponse ? 1 : 0) || tris[f.lane === 'CLOS' ? 'maj' : f.tri](a, b); });
    } else {
      items.sort(tris[f.lane === 'CLOS' && f.tri === 'ancien' ? 'maj' : f.tri]);
    }
    const lane = defs.find(function (d) { return d.k === f.lane; });
    const aides = {
      NOUVEAU: 'Du plus ancien au plus récent : traitez en priorité ceux qui attendent depuis longtemps.',
      EN_COURS: 'Incidents pris en charge. Les réponses des points de vente apparaissent en premier.',
      ATTENTE: 'Le point de vente doit fournir une information pour que le traitement continue.',
      CLOS: 'Incidents résolus ou rejetés ces 7 derniers jours.',
    };

    return '<section class="lanes">' + defs.map(function (d) {
      return '<button type="button" class="lane' + (f.lane === d.k ? ' on' : '') + '" style="--kc:var(' + d.c + ')" data-act="lane" data-v="' + d.k + '">' +
        '<span class="lane-t">' + ico(d.ico) + d.t + '</span><span class="lane-v">' + lanes[d.k].length + '</span><span class="lane-s">' + d.s + '</span></button>';
    }).join('') + '</section>' +
      '<div class="toolbar">' + recherche('file.q', f.q, 'Rechercher : n°, PDV, référence, téléphone…') +
      '<div class="tb-f">' + selectPdv('file.pdv', f.pdv) + selectNature('file.nature', f.nature) + selectOp('file.op', f.op) +
      '<select class="in in-sm" id="sel-file-tri" data-f="file.tri" aria-label="Trier"><option value="ancien"' + (f.tri === 'ancien' ? ' selected' : '') + '>Plus anciens d\'abord</option><option value="recent"' + (f.tri === 'recent' ? ' selected' : '') + '>Plus récents d\'abord</option><option value="montant"' + (f.tri === 'montant' ? ' selected' : '') + '>Montant le plus élevé</option><option value="maj"' + (f.tri === 'maj' ? ' selected' : '') + '>Dernière activité</option></select></div>' +
      '</div>' + filtresActifs(f, 'file') +
      '<section><div class="sh"><h2 class="sh-t">' + lane.t + ' <span class="cnt">' + items.length + '</span></h2><span class="sh-r">' + aides[f.lane] + '</span></div>' +
      '<div class="card">' + liste(items, { rapide: true }, {
        ico: 'circle-check-big', titre: f.lane === 'NOUVEAU' ? 'Tout est pris en charge' : 'Rien ici',
        texte: f.q || f.pdv || f.nature || f.op ? 'Aucun incident ne correspond aux filtres.' : f.lane === 'NOUVEAU' ? 'Aucun incident n\'attend de prise en charge. Bravo !' : '',
      }) + '</div></section>';
  }

  /* ================= Pilotage (BO) / Statistiques (PDV) ================= */

  function vuePilotage() {
    const pdv = estBO() ? S.per.pdv : '';
    const items = dansPeriode(S.incidents, bornes(), pdv);
    const bp = bornesPrecedentes();
    const avant = bp ? stats(dansPeriode(S.incidents, bp, pdv)) : null;
    const st = stats(items);
    const ouvertsTous = stats(S.incidents.filter(function (i) { return !pdv || i.pdv === pdv; }));
    const segs = ['TERMINE', 'REJETE', 'EN_COURS', 'ATTENTE', 'NOUVEAU'];
    S.pilotage = { items: items };

    return '<div class="pilot-h"><div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">' + segPeriode() + (estBO() ? selectPdv('per.pdv', S.per.pdv) : '') + '</div>' +
      '<span class="sh-r">' + ico('calendar') + ' Déclarations ' + libellePeriode() + (bp ? ' · comparé à la période précédente' : '') + '</span></div>' +

      '<section class="kg">' +
      kpi({ ico: 'clipboard-list', l: 'Incidents déclarés', val: nombre(st.n), c: '--brand', s: (avant ? variation(st.n, avant.n) + ' vs période préc.' : 'sur la période') }) +
      kpi({ ico: 'wallet', l: 'Montant concerné', val: compact(st.montant), u: 'FCFA', c: '--accent', s: 'dont ' + compact(st.montantOuvert) + ' FCFA encore ouverts' }) +
      kpi({ ico: 'gauge', l: 'Taux de traitement', val: st.taux, u: '%', c: '--done', s: st.traites + ' traité(s) sur ' + st.n + (avant && avant.n ? ' · ' + variation(st.taux, avant.taux, true) : '') }) +
      kpi({ ico: 'timer', l: 'Délai moyen de résolution', val: duree(st.delaiMoyen), c: '--prog', s: 'prise en charge en ' + duree(st.delaiPec) + ' en moyenne' }) +
      '</section>' +

      '<div class="card card-p"><div class="sh" style="margin:0"><div><h3 class="ct">Où en sont les incidents de la période ?</h3><p class="cs">' +
      (st.n ? st.ouverts + ' encore ouvert(s) · ' + st.traites + ' traité(s)' : 'Aucun incident déclaré sur la période.') + '</p></div>' +
      (estBO() && ouvertsTous.retard ? '<button type="button" class="tag hot" data-act="voir-etat" data-v="NOUVEAU" style="border:none;cursor:pointer">' + ico('alarm-clock') + ouvertsTous.retard + ' en retard de prise en charge</button>' : '') + '</div>' +
      '<div class="stack">' + segs.map(function (k) {
        return '<span style="width:' + (st.n ? (st[k] / st.n) * 100 : 0) + '%;background:var(' + ETATS[k].var + ')" title="' + ETATS[k].pluriel + ' : ' + st[k] + '"></span>';
      }).join('') + '</div>' +
      '<div class="leg">' + segs.map(function (k) { return '<span><i style="background:var(' + ETATS[k].var + ')"></i>' + ETATS[k].pluriel + ' <b>' + st[k] + '</b></span>'; }).join('') + '</div></div>' +

      '<section class="cg">' +
      '<div class="card c8"><h3 class="ct">Déclarations et clôtures dans le temps</h3><p class="cs">Nombre d\'incidents déclarés et traités</p><div class="ch"><canvas id="cEvol"></canvas></div></div>' +
      '<div class="card c4"><h3 class="ct">Montant par nature</h3><p class="cs">En FCFA, sur la période</p><div class="ch ring"><canvas id="cNature"></canvas><div class="ring-c"><b>' + compact(st.montant) + '</b><small>FCFA</small></div></div></div>' +
      '<div class="card ' + (estBO() ? 'c6' : 'c12') + '"><h3 class="ct">Par moyen de paiement</h3><p class="cs">Incidents déclarés, par état</p><div class="ch"><canvas id="cOp"></canvas></div></div>' +
      (estBO() ? '<div class="card c6"><div class="sh" style="margin:0"><div><h3 class="ct">Points de vente les plus concernés</h3><p class="cs">Cliquez pour voir leurs incidents</p></div><a class="lnk" href="#/pdv">Synthèse ' + ico('arrow-right') + '</a></div>' + classementPdv(items) + '</div>' : '') +
      '</section>';
  }

  function classementPdv(items) {
    const par = {};
    items.forEach(function (i) { (par[i.pdv] = par[i.pdv] || []).push(i); });
    const rangs = Object.keys(par).map(function (p) { return { p: p, st: stats(par[p]) }; }).sort(function (a, b) { return b.st.n - a.st.n; }).slice(0, 8);
    if (!rangs.length) return '<div class="empty">Aucun incident sur la période.</div>';
    const max = rangs[0].st.n;
    const segs = ['TERMINE', 'REJETE', 'EN_COURS', 'ATTENTE', 'NOUVEAU'];
    return '<div class="rank">' + rangs.map(function (r) {
      return '<button type="button" class="rank-r" data-act="voir-pdv" data-v="' + esc(r.p) + '"><b>' + esc(r.p) + '</b>' +
        '<span class="pbt" style="width:' + Math.max(8, (r.st.n / max) * 100) + '%">' + segs.map(function (k) {
          return '<span style="width:' + (r.st[k] / r.st.n) * 100 + '%;background:var(' + ETATS[k].var + ')"></span>';
        }).join('') + '</span><span class="num">' + r.st.n + '</span></button>';
    }).join('') + '</div>';
  }

  function graphiquesPilotage() {
    if (!window.Chart || !S.pilotage) return;
    const liste = S.pilotage.items;
    const ink = cssVar('--muted');
    const grille = cssVar('--line');
    const surface = cssVar('--surface');
    Chart.defaults.font.family = "'Plus Jakarta Sans', ui-sans-serif, system-ui, sans-serif";
    Chart.defaults.font.size = 12;
    Chart.defaults.color = ink;
    Chart.defaults.borderColor = grille;
    const legende = { position: 'bottom', labels: { boxWidth: 9, boxHeight: 9, usePointStyle: true, pointStyle: 'rectRounded', padding: 14 } };
    const tooltip = { backgroundColor: '#0d1526', padding: 10, cornerRadius: 8, titleFont: { weight: 700 }, boxPadding: 4 };
    const nouv = function (id, cfg) { const el = document.getElementById(id); if (el) S.charts[id] = new Chart(el, cfg); };

    // Évolution
    const b = bornes();
    let debut = b.du;
    if (!debut) {
      const dates = liste.map(function (i) { return date(i.cree_le); });
      debut = dates.length ? new Date(Math.min.apply(null, dates)) : new Date();
    }
    const fin = b.au ? new Date(b.au - 1) : new Date();
    const parMois = (fin - debut) / 864e5 > 92;
    const parSem = !parMois && (fin - debut) / 864e5 > 45;
    const debutSem = function (d) { const x = new Date(d.getFullYear(), d.getMonth(), d.getDate()); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return x; };
    const cleT = function (d) { return parMois ? d.getFullYear() + '-' + p2(d.getMonth() + 1) : cleJour(parSem ? debutSem(d) : d); };
    const etiquettes = [];
    const cur = parMois ? new Date(debut.getFullYear(), debut.getMonth(), 1) : parSem ? debutSem(debut) : new Date(debut.getFullYear(), debut.getMonth(), debut.getDate());
    while (cur <= fin && etiquettes.length < 400) {
      etiquettes.push(cleT(cur));
      if (parMois) cur.setMonth(cur.getMonth() + 1); else cur.setDate(cur.getDate() + (parSem ? 7 : 1));
    }
    const compte = function (champ, filtre) {
      const m = {};
      liste.forEach(function (i) {
        if (filtre && !filtre(i)) return;
        const d = date(i[champ]);
        if (d) m[cleT(d)] = (m[cleT(d)] || 0) + 1;
      });
      return etiquettes.map(function (k) { return m[k] || 0; });
    };
    const cNew = cssVar('--new');
    const cDone = cssVar('--done');
    nouv('cEvol', {
      type: 'bar',
      data: {
        labels: etiquettes.map(function (k) { const x = k.split('-'); return parMois ? x[1] + '/' + x[0].slice(2) : (parSem ? 'sem. ' : '') + x[2] + '/' + x[1]; }),
        datasets: [
          { label: 'Déclarés', data: compte('cree_le'), backgroundColor: cNew, borderRadius: 3, maxBarThickness: 14, categoryPercentage: .7, barPercentage: .9 },
          { label: 'Traités', data: compte('cloture_le', function (i) { return !estOuvert(i); }), backgroundColor: cDone, borderRadius: 3, maxBarThickness: 14, categoryPercentage: .7, barPercentage: .9 },
        ],
      },
      options: {
        responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
        plugins: { legend: legende, tooltip: tooltip },
        scales: { x: { grid: { display: false }, ticks: { maxRotation: 0, autoSkip: true, maxTicksLimit: 10 } }, y: { beginAtZero: true, ticks: { precision: 0 }, border: { display: false } } },
      },
    });

    // Montant par nature
    const natures = Object.keys(NATURES);
    const couleursNat = { DEPOT: cssVar('--prog'), RETRAIT: cssVar('--wait'), FORMALITE: cssVar('--accent') };
    nouv('cNature', {
      type: 'doughnut',
      data: {
        labels: natures.map(function (n) { return NATURES[n].libelle; }),
        datasets: [{
          data: natures.map(function (n) { return liste.filter(function (i) { return nature(i) === n; }).reduce(function (s, i) { return s + (Number(i.montant) || 0); }, 0); }),
          backgroundColor: natures.map(function (n) { return couleursNat[n]; }), borderWidth: 3, borderColor: surface, hoverOffset: 6,
        }],
      },
      options: {
        responsive: true, maintainAspectRatio: false, cutout: '70%',
        plugins: { legend: legende, tooltip: Object.assign({}, tooltip, { callbacks: { label: function (c) { return ' ' + c.label + ' : ' + fcfa(c.raw); } } }) },
      },
    });

    // Par opérateur
    const etatsOp = ['NOUVEAU', 'EN_COURS', 'ATTENTE', 'TERMINE', 'REJETE'];
    const ops = C.OPERATEURS.filter(function (o) { return liste.some(function (i) { return i.operateur === o.code; }); });
    nouv('cOp', {
      type: 'bar',
      data: {
        labels: ops.map(function (o) { return o.nom; }),
        datasets: etatsOp.map(function (s) {
          return {
            label: ETATS[s].pluriel, backgroundColor: cssVar(ETATS[s].var), borderRadius: 4, borderSkipped: false, maxBarThickness: 34,
            data: ops.map(function (o) { return liste.filter(function (i) { return i.operateur === o.code && etat(i) === s; }).length; }),
          };
        }),
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: legende, tooltip: tooltip },
        scales: { x: { stacked: true, grid: { display: false } }, y: { stacked: true, beginAtZero: true, ticks: { precision: 0 }, border: { display: false } } },
      },
    });
  }

  /* ================= Vue BO : Registre ================= */

  function vueRegistre() {
    const f = S.reg;
    const items = filtrerChamps(rechercher(dansPeriode(S.incidents, bornes()), f.q), f);
    const val = {
      id: function (i) { return i.id; }, cree_le: function (i) { return String(i.cree_le); }, pdv: function (i) { return i.pdv; },
      montant: function (i) { return Number(i.montant) || 0; }, etat: function (i) { return ORDRE.indexOf(etat(i)); },
      maj_le: function (i) { return String(i.maj_le); }, age: function (i) { return String(i.cree_le); },
    };
    const v = val[f.tri] || val.cree_le;
    const lignes = items.slice().sort(function (a, b) {
      const x = v(a);
      const y = v(b);
      return (x < y ? -1 : x > y ? 1 : 0) * f.sens;
    });
    S.lignesExport = lignes;
    const th = function (k, l, cls) {
      const on = f.tri === k;
      return '<th class="sort ' + (cls || '') + '" data-act="tri" data-v="' + k + '">' + l + (on ? '<span class="ar">' + (f.sens > 0 ? '↑' : '↓') + '</span>' : '') + '</th>';
    };
    const etats = '<select class="in in-sm" id="sel-reg-etat" data-f="reg.etat" aria-label="État"><option value="">Tous états</option>' +
      ORDRE.map(function (e) { return '<option value="' + e + '"' + (f.etat === e ? ' selected' : '') + '>' + ETATS[e].pluriel + '</option>'; }).join('') + '</select>';
    const visibles = lignes.slice(0, f.limite);
    const total = lignes.reduce(function (s, i) { return s + (Number(i.montant) || 0); }, 0);

    return '<div class="pilot-h">' + segPeriode() + '<div style="display:flex;gap:8px"><button type="button" class="btn bo btn-sm" data-act="xlsx">' + ico('file-spreadsheet') + 'Exporter Excel</button><button type="button" class="btn bo btn-sm" data-act="print">' + ico('printer') + 'Imprimer</button></div></div>' +
      '<div class="toolbar">' + recherche('reg.q', f.q, 'N°, référence, liquidation, téléphone, description…') + '<div class="tb-f">' + selectPdv('reg.pdv', f.pdv) + selectNature('reg.nature', f.nature) + selectOp('reg.op', f.op) + etats + '</div></div>' +
      filtresActifs(f, 'reg') +
      '<div class="card"><div class="tw"><table class="tbl"><thead><tr>' +
      th('id', 'N°') + th('cree_le', 'Déclaré') + th('pdv', 'Point de vente') + '<th>Opération</th><th>Réf. / Liquidation</th>' +
      th('montant', 'Montant', 'num') + th('etat', 'État') + th('maj_le', 'Dernière action') +
      '</tr></thead><tbody data-liste>' + visibles.map(function (i) {
        const m = S.meta[i.id] || {};
        return '<tr data-open="' + esc(i.id) + '">' +
          '<td class="nw"><span class="mono">' + esc(i.id) + '</span></td>' +
          '<td class="nw">' + fDate(i.cree_le) + '<div class="sub">' + fHeure(i.cree_le) + '</div></td>' +
          '<td><b>' + esc(i.pdv) + '</b></td>' +
          '<td><div class="op">' + (operateur(i.operateur) ? logoOp(operateur(i.operateur)) : '') + '<span>' + esc(NATURES[nature(i)] ? NATURES[nature(i)].libelle : '') + '<div class="sub">' + esc(i.categorie === 'FORMALITE' ? i.incident : (operateur(i.operateur) || {}).nom) + '</div></span></div></td>' +
          '<td class="mono">' + (reference(i) ? esc(reference(i)) : '<span class="z">—</span>') + '</td>' +
          '<td class="num"><b>' + nombre(i.montant) + '</b></td>' +
          '<td class="nw">' + badge(etat(i)) + '<div class="sub" style="margin-top:4px">' + tagAge(i) + '</div></td>' +
          '<td class="clip">' + esc(m.derniere ? m.derniere.libelle : 'Déclaration') + '<div class="sub">' + quand(i.maj_le) + '</div></td></tr>';
      }).join('') + '</tbody></table>' +
      (lignes.length ? '' : '<div class="empty"><span class="em-i">' + ico('search-x') + '</span><b>Aucun incident</b>Aucun incident ne correspond à ces critères.</div>') + '</div>' +
      '<div class="tfoot"><span><b>' + lignes.length + '</b> incident(s) · ' + fcfa(total) + '</span>' +
      (lignes.length > f.limite ? '<button type="button" class="btn bo btn-sm" data-act="plus">Afficher ' + Math.min(PAR_PAGE, lignes.length - f.limite) + ' de plus</button>' : '') + '</div></div>';
  }

  /* ================= Vue BO : Synthèse par PDV ================= */

  function vueSynthese() {
    const items = dansPeriode(S.incidents, bornes());
    const lignes = C.POINTS_DE_VENTE.map(function (p) {
      const l = items.filter(function (i) { return i.pdv === p; });
      const ouverts = S.incidents.filter(function (i) { return i.pdv === p && estOuvert(i); });
      const attente = ouverts.reduce(function (m, i) { return Math.max(m, heuresDepuis(i.cree_le)); }, -1);
      const retard = ouverts.filter(function (i) { return i.statut === 'NOUVEAU' && heuresDepuis(i.cree_le) >= C.SEUIL_ALERTE_HEURES; }).length;
      return { p: p, st: stats(l), ouverts: ouverts.length, attente: attente, retard: retard };
    }).sort(function (a, b) { return b.ouverts - a.ouverts || b.st.n - a.st.n || a.p.localeCompare(b.p); });
    const z = function (n) { return n ? nombre(n) : '<span class="z">0</span>'; };
    const sante = function (x) {
      if (!x.st.n && !x.ouverts) return '<span class="health h-na">Aucun incident</span>';
      if (x.retard) return '<span class="health h-ko" title="Incident(s) non pris en charge depuis plus de ' + C.SEUIL_ALERTE_HEURES + ' h">' + x.retard + ' en retard</span>';
      if (x.attente >= 24 * 7) return '<span class="health h-mid" title="Incident ouvert depuis plus de 7 jours">Traitement long</span>';
      return '<span class="health h-ok">Bon</span>';
    };
    const actifs = lignes.filter(function (x) { return x.st.n || x.ouverts; }).length;
    const segs = ['TERMINE', 'REJETE', 'EN_COURS', 'ATTENTE', 'NOUVEAU'];

    return '<div class="pilot-h">' + segPeriode() + '<span class="sh-r">' + actifs + ' PDV concernés ' + libellePeriode() + ' · cliquez sur une ligne pour voir ses incidents</span></div>' +
      '<div class="card"><div class="tw"><table class="tbl"><thead><tr>' +
      '<th>Point de vente</th><th>Santé</th><th class="num">Ouverts</th><th class="num">Déclarés</th><th class="num">Montant</th>' +
      '<th style="min-width:180px">Répartition</th><th class="num">Taux traité</th><th class="num">Délai moyen</th><th>Plus ancien ouvert</th>' +
      '</tr></thead><tbody>' + lignes.map(function (x) {
        const st = x.st;
        return '<tr data-act="voir-pdv" data-v="' + esc(x.p) + '">' +
          '<td><b>' + esc(x.p) + '</b></td><td>' + sante(x) + '</td>' +
          '<td class="num">' + (x.ouverts ? '<b>' + x.ouverts + '</b>' : '<span class="z">0</span>') + '</td>' +
          '<td class="num">' + z(st.n) + '</td>' +
          '<td class="num">' + (st.montant ? nombre(st.montant) : '<span class="z">0</span>') + '</td>' +
          '<td>' + (st.n ? '<div class="pbt">' + segs.map(function (k) { return '<span style="width:' + (st[k] / st.n) * 100 + '%;background:var(' + ETATS[k].var + ')" title="' + ETATS[k].pluriel + ' : ' + st[k] + '"></span>'; }).join('') + '</div>' : '<span class="z">—</span>') + '</td>' +
          '<td class="num">' + (st.n ? st.taux + ' %' : '<span class="z">—</span>') + '</td>' +
          '<td class="num">' + (st.delaiMoyen !== null ? duree(st.delaiMoyen) : '<span class="z">—</span>') + '</td>' +
          '<td>' + (x.attente >= 0 ? '<span class="tag' + (x.attente >= C.SEUIL_ALERTE_HEURES ? ' hot' : '') + '">' + ico('clock') + duree(x.attente) + '</span>' : '<span class="z">—</span>') + '</td>' +
          '</tr>';
      }).join('') + '</tbody></table></div></div>';
  }

  /* ================= Panneau de détail ================= */

  function ouvrirPanneau(id, contexte) {
    if (!parId(id)) return;
    S.ouvert = id;
    if (contexte && contexte.length) S.contexte = contexte;
    else if (S.contexte.indexOf(id) < 0) S.contexte = [id];
    marquerVu(id);
    rendrePanneau(true);
    $('#ov').classList.add('on');
    $('#pnl').classList.add('on');
    $('#pnl').setAttribute('aria-hidden', 'false');
    const h = '#/' + S.vue + '?i=' + encodeURIComponent(id);
    if (location.hash !== h) history.replaceState(null, '', h);
    $$('.ic.sel').forEach(function (x) { x.classList.remove('sel'); });
    $$('.ic[data-open="' + id + '"]').forEach(function (x) { x.classList.add('sel', 'lu'); x.classList.remove('unread'); });
    majCompteurs();
  }

  function fermerPanneau() {
    if (!S.ouvert) return;
    S.ouvert = null;
    $('#ov').classList.remove('on');
    $('#pnl').classList.remove('on');
    $('#pnl').setAttribute('aria-hidden', 'true');
    if (S.session) history.replaceState(null, '', '#/' + S.vue);
    $$('.ic.sel').forEach(function (x) { x.classList.remove('sel'); });
    rendre();
  }

  function voisin(d) {
    const k = S.contexte.indexOf(S.ouvert);
    const id = S.contexte[k + d];
    if (id) ouvrirPanneau(id, S.contexte);
  }

  function rendrePanneau(nouveau) {
    const i = parId(S.ouvert);
    if (!i) { fermerPanneau(); return; }
    // Ne pas écraser une saisie en cours lors d'un rafraîchissement automatique.
    const brouillon = !nouveau && $('#fAct') ? { com: ($('#fAct [name=commentaire]') || {}).value, ref: ($('#fAct [name=reference]') || {}).value, code: ($('#fAct [name=code]:checked') || {}).value } : null;
    const k = S.contexte.indexOf(i.id);
    $('#pPrev').disabled = k <= 0;
    $('#pNext').disabled = k < 0 || k >= S.contexte.length - 1;
    $('#pPos').textContent = S.contexte.length > 1 && k >= 0 ? (k + 1) + ' / ' + S.contexte.length : '';
    const e = etat(i);
    const m = S.meta[i.id] || {};
    const op = operateur(i.operateur);

    const it = function (l, v, large, copie) {
      return '<div class="pi' + (large === 2 ? ' w2' : large ? ' w' : '') + '"><div class="pil">' + l + '</div><div class="piv">' + (v || '<span class="z">—</span>') +
        (copie ? '<button type="button" class="cp" data-copy="' + esc(copie) + '" title="Copier">' + ico('copy') + '</button>' : '') + '</div></div>';
    };
    const champs = i.categorie === 'FORMALITE'
      ? [it('Incident survenu', esc(i.incident)), it('Formalité voulue', esc(i.formalite)),
        it('N° de liquidation', i.num_liquidation ? '<span class="mono">' + esc(i.num_liquidation) + '</span>' : '', false, i.num_liquidation),
        it('Moyen de paiement', i.operateur ? pastilleOp(i.operateur) : 'Espèces / autre'),
        it("Date de l'opération", fDateOp(i.date_operation)), it('Déclaré le', fDateHeure(i.cree_le)),
        it('Déclaré par', esc(declarePar(i)), true)]
      : [it('Moyen de paiement', pastilleOp(i.operateur)), it("Date de l'opération", fDateOp(i.date_operation)),
        it('N° client', i.telephone ? '<span class="mono">' + esc(i.telephone) + '</span>' : '', false, i.telephone),
        it('Référence transaction', i.reference ? '<span class="mono">' + esc(i.reference) + '</span>' : '', 2, i.reference),
        it('Déclaré le', fDateHeure(i.cree_le)), it('Déclaré par', esc(declarePar(i)), true)];
    if (i.solution && i.solution !== SOLUTION_PAR_DEFAUT) champs.push(it('Solution souhaitée par le PDV', esc(i.solution), true));

    // Suivi en 4 étapes
    const st = etape(i);
    const clos = !estOuvert(i);
    const tc = 'var(' + ETATS[e].var + ')';
    const pas = [
      { l: 'Déclaré', d: i.cree_le, ico: 'send' },
      { l: 'Pris en charge', d: m.pec, ico: 'hand' },
      { l: 'En traitement', d: m.traitement, ico: 'loader' },
      { l: clos ? (i.statut === 'REJETE' ? 'Rejeté' : 'Résolu') : 'Résolu', d: i.cloture_le, ico: i.statut === 'REJETE' ? 'x' : 'check' },
    ];
    const track = '<div class="track" style="--tc:' + tc + '">' + pas.map(function (p, n) {
      const on = n + 1 <= st;
      return '<div class="track-s' + (on ? ' on' : '') + (n + 1 === st ? ' cur' : '') + '"><span class="track-d">' + ico(on ? p.ico : 'circle') + '</span>' + p.l +
        '<small>' + (on && p.d ? quand(p.d) : '') + '</small></div>';
    }).join('') + '</div>';

    // Fil de suivi
    const tl = ['<div class="tli' + (i.pdv === moi() ? ' me' : '') + '"><div class="tld start">' + ico('send') + '</div><div class="tlb"><div class="tdh">Déclaration de l\'incident<span class="tdt">' + esc(declarePar(i)) + ' · ' + fDateHeure(i.cree_le) + '</span></div></div></div>'];
    actionsDe(i.id).forEach(function (a) {
      const cls = a.code === 'TERMINE' ? 'done' : a.code === 'REJETE' ? 'blocked' : a.code === 'INFO_PDV' ? 'ask' : a.code === 'COMPLEMENT' ? 'pdv' : a.code === 'COMMENTAIRE' ? '' : 'ongoing';
      tl.push('<div class="tli' + (a.auteur === moi() ? ' me' : '') + '"><div class="tld ' + cls + '">' + ico(ICO_ACTION[a.code] || 'dot') + '</div><div class="tlb">' +
        '<div class="tdh">' + esc(a.libelle) + (a.reference && a.code !== 'DEMANDE_REGULARISATION' ? '<span class="tdr">' + esc(a.reference) + '</span>' : '') +
        '<span class="tdt">' + esc(a.auteur === BO ? (a.agent || 'Back Office') : a.auteur) + ' · ' + fDateHeure(a.cree_le) + '</span></div>' +
        (a.code === 'DEMANDE_REGULARISATION' && a.reference ? '<div class="tdm">' + ico('mail') + '<span>Mail à Alima' + (a.date_envoi ? ' du <b>' + fDateOp(a.date_envoi) + '</b>' : '') + ' : « ' + esc(a.reference) + ' »</span></div>' : '') +
        (a.commentaire ? '<div class="tdd">' + esc(a.commentaire) + '</div>' : '') + '</div></div>');
    });

    // Deux colonnes : le dossier à gauche, l'échange avec le Back Office à droite (sans défilement de la page).
    $('#pBody').innerHTML =
      '<div class="p-grid"><div class="p-head" style="--tc:' + tc + '"><div class="p-head-l">' +
      '<div class="p-id">' + icoNature(i) + '<span class="mono">' + esc(i.id) + '</span><button type="button" class="cp" data-copy="' + esc(i.id) + '" title="Copier le n°">' + ico('copy') + '</button>' + badge(e) + tagAge(i) + '</div>' +
      '<div class="p-hero"><h2 class="p-amt" id="pTitle">' + nombre(i.montant) + '<small>FCFA</small></h2>' +
      '<div class="p-sub"><span>' + esc(sousTitre(i)) + '</span>' + (estBO() ? '<span class="z">·</span><b>' + esc(i.pdv) + '</b>' : '') + (op ? '<span class="z">·</span>' + pastilleOp(i.operateur) : '') + '</div></div>' +
      '</div>' + track + '</div><div class="p-col p-l">' + prochaineEtape(i) +
      '<div class="ps"><div class="pst">' + ico('info') + 'Informations déclarées</div><div class="pg">' + champs.join('') + '</div></div>' +
      '<div class="ps"><div class="pst">' + ico('message-square-text') + 'Ce qui s\'est passé</div><div class="ptx">' + esc(i.description) + '</div></div>' +
      '</div><div class="p-col p-r">' +
      '<div class="ps p-hist"><div class="pst">' + ico('history') + 'Historique du traitement<span class="pst-n">' + tl.length + '</span></div><div class="tl" id="pTl">' + tl.join('') + '</div></div>' +
      formulaireAction(i) + '</div></div>';
    icones();
    lierFormulaire(brouillon);
    $$('#pBody [data-pec]').forEach(function (b) { b.addEventListener('click', function () { actionRapide(i.id, 'PRISE_EN_CHARGE', null, b); }); });
    if (nouveau) $('#pBody').scrollTop = 0;
    // Le fil de suivi s'ouvre sur la dernière action.
    const fil = $('#pTl');
    if (fil) fil.scrollTop = fil.scrollHeight;
  }

  // Encadré « que faire maintenant ? » adapté au rôle et à l'état.
  function prochaineEtape(i) {
    const e = etat(i);
    const m = S.meta[i.id] || {};
    const boite = function (cls, icone, titre, texte, actions) {
      return '<div class="next ' + cls + '"><div class="next-t">' + ico(icone) + titre + '</div><div class="next-d">' + texte + '</div>' + (actions ? '<div class="next-a">' + actions + '</div>' : '') + '</div>';
    };
    if (estBO()) {
      if (e === 'NOUVEAU') {
        return boite('hl-new', 'hand', 'À prendre en charge', 'Déclaré ' + ilya(i.cree_le) + '. Prenez-le en charge pour informer le point de vente que le traitement a commencé : les autres actions (demande d\'information, CA, relance…) seront alors disponibles.',
          '<button type="button" class="btn bp" data-pec>' + ico('hand') + 'Prendre en charge</button>');
      }
      if (e === 'ATTENTE') {
        return boite('hl', 'hourglass', 'En attente du point de vente', 'Information demandée ' + ilya(m.question.cree_le) + (m.question.commentaire ? ' : « ' + esc(m.question.commentaire) + ' »' : '') + '. Vous pouvez relancer ou continuer le traitement.',
          '<button type="button" class="btn bo btn-sm" data-pick="COMMENTAIRE">' + ico('message-square') + 'Ajouter un commentaire</button><button type="button" class="btn b-ok btn-sm" data-pick="TERMINE">' + ico('circle-check') + 'Marquer résolu</button>');
      }
      if (e === 'EN_COURS') {
        return boite(m.reponse ? 'hl' : '', m.reponse ? 'reply' : 'loader', m.reponse ? 'Le point de vente a répondu' : 'Traitement en cours',
          m.reponse ? 'Lisez sa réponse dans l\'historique, puis poursuivez le traitement.' : 'Dernière action : ' + esc(m.derniere ? m.derniere.libelle : '') + ' ' + ilya(i.maj_le) + '.',
          '<button type="button" class="btn bo btn-sm" data-pick="CREATION_CA">' + ico('file-plus-2') + 'Créer un CA</button><button type="button" class="btn bo btn-sm" data-pick="RELANCE">' + ico('phone-outgoing') + 'Relancer</button><button type="button" class="btn b-ok btn-sm" data-pick="TERMINE">' + ico('circle-check') + 'Marquer résolu</button>');
      }
      return boite('', i.statut === 'TERMINE' ? 'circle-check' : 'circle-x', i.statut === 'TERMINE' ? 'Incident résolu' : 'Incident rejeté',
        'Clôturé le ' + fDateHeure(i.cloture_le) + (i.cloture_le ? ', ' + duree((date(i.cloture_le) - date(i.cree_le)) / 36e5) + ' après la déclaration.' : '.'), '');
    }
    if (e === 'ATTENTE') {
      return boite('hl', 'message-circle-question', 'Le Back Office a besoin d\'une information',
        m.question && m.question.commentaire ? '« ' + esc(m.question.commentaire) + ' »' : 'Répondez ci-dessous pour que le traitement continue.',
        '<button type="button" class="btn bp btn-sm" data-focus="1">' + ico('reply') + 'Répondre maintenant</button>');
    }
    if (e === 'NOUVEAU') return boite('', 'hourglass', 'Transmis au Back Office', 'Votre déclaration a été reçue ' + ilya(i.cree_le) + '. Elle sera prise en charge sous peu.', '');
    if (e === 'EN_COURS') return boite('', 'loader', 'Le Back Office traite votre incident', 'Dernière action : ' + esc(m.derniere ? m.derniere.libelle : '') + ' ' + ilya(i.maj_le) + '. Rien à faire de votre côté pour l\'instant.', '');
    return boite('', i.statut === 'TERMINE' ? 'circle-check' : 'circle-x', i.statut === 'TERMINE' ? 'Incident résolu' : 'Incident rejeté par le Back Office',
      'Clôturé le ' + fDateHeure(i.cloture_le) + '. ' + (m.derniere && m.derniere.commentaire ? '« ' + esc(m.derniere.commentaire) + ' »' : ''), '');
  }

  function formulaireAction(i) {
    if (estBO()) {
      // Tant que l'incident n'est pas pris en charge, seule la prise en charge est possible (encadré ci-dessus).
      if (i.statut === 'NOUVEAU') {
        return '<div class="ps" id="cmpWrap"><div class="pec-lock">' + ico('lock') + '<span>Prenez l\'incident en charge pour débloquer les actions de suivi.</span></div></div>';
      }
      const agent = (S.session.user && S.session.user.nom) || memoire.lire(cle('agent')) || '';
      return '<div class="ps" id="cmpWrap"><div class="pst">' + ico('square-pen') + 'Ajouter une action</div><form class="cmp" id="fAct" novalidate>' +
        '<div class="acts">' + C.ACTIONS_BO.filter(function (a) { return a.code !== 'PRISE_EN_CHARGE'; }).map(function (a) {
          const t = a.statut === 'TERMINE' ? ' class="t-ok"' : a.statut === 'REJETE' ? ' class="t-ko"' : '';
          return '<label' + t + ' title="' + esc(a.libelle) + '"><input type="radio" name="code" value="' + esc(a.code) + '"><span>' + ico(ICO_ACTION[a.code] || 'dot') + esc(COURTS_ACTION[a.code] || a.libelle) + '</span></label>';
        }).join('') + '</div>' +
        '<div id="aRefWrap" hidden><div class="fr fr-act"><div class="fcol" id="aRefCol"><label class="fl" for="aRef" id="aRefL">Référence</label><input class="in" id="aRef" name="reference" autocomplete="off"></div>' +
        '<div class="fcol" id="aEnvWrap" hidden><label class="fl" for="aEnv">Date d\'envoi du mail *</label><input class="in" id="aEnv" name="date_envoi" type="date" max="' + cleJour(new Date()) + '"></div></div></div>' +
        '<label class="fl" for="aCom" id="aComL">Commentaire</label><textarea class="in" id="aCom" name="commentaire" rows="2" placeholder="Détail de l\'action, réponse de l\'opérateur, consigne au PDV…"></textarea>' +
        '<div id="aAgentWrap"' + (agent ? ' hidden' : '') + '><label class="fl" for="aAgent">Votre nom (agent Back Office) *</label><input class="in" id="aAgent" name="agent" value="' + esc(agent) + '" autocomplete="name"></div>' +
        '<div class="msg err" id="aErr" hidden></div>' +
        '<div class="cmp-ft">' + (agent ? '<span class="agent">' + ico('user') + 'Agent : <b>' + esc(agent) + '</b>' + (S.session.user ? '' : '<button type="button" id="aAgentEdit">modifier</button>') + '</span>' : '') +
        '<span class="grow"></span><button class="btn bp" type="submit" id="aGo">' + ico('check') + 'Enregistrer</button></div>' +
        '</form></div>';
    }
    const attente = etat(i) === 'ATTENTE';
    return '<div class="ps" id="cmpWrap"><div class="pst">' + ico('reply') + (attente ? 'Votre réponse au Back Office' : 'Écrire au Back Office') + '</div><form class="cmp" id="fAct" novalidate>' +
      '<input type="hidden" name="code" value="COMPLEMENT">' +
      '<textarea class="in" id="aCom" name="commentaire" rows="3" placeholder="' + (attente ? 'Votre réponse…' : 'Une nouvelle information, une précision…') + '"></textarea>' +
      '<div class="msg err" id="aErr" hidden></div>' +
      '<div class="cmp-ft"><span class="grow"></span><button class="btn bp" type="submit" id="aGo">' + ico('send') + 'Envoyer</button></div></form></div>';
  }

  const LIBELLES_ENVOI = {
    PRISE_EN_CHARGE: 'Prendre en charge', TERMINE: 'Clôturer comme résolu', REJETE: "Rejeter l'incident",
    INFO_PDV: 'Envoyer la demande au PDV', COMMENTAIRE: 'Ajouter le commentaire',
  };
  const AIDES_COMMENTAIRE = {
    INFO_PDV: ['Question au point de vente *', 'Quelle information vous manque ? (capture du reçu, n° du client…)'],
    REJETE: ['Motif du rejet *', 'Pourquoi la demande est-elle non fondée ?'],
    TERMINE: ['Comment l\'incident a été résolu', 'Ex. : client remboursé le…, régularisation faite par l\'opérateur…'],
    COMMENTAIRE: ['Commentaire *', 'Note interne ou information pour le point de vente…'],
  };
  const COMMENTAIRE_REQUIS = ['INFO_PDV', 'REJETE', 'COMMENTAIRE'];

  function lierFormulaire(brouillon) {
    const f = $('#fAct');
    if (!f) return;
    f.addEventListener('submit', soumettreAction);
    if (estBO()) {
      const maj = function () {
        const code = (f.querySelector('[name=code]:checked') || {}).value;
        $('#aRefWrap').hidden = AVEC_REFERENCE.indexOf(code) < 0;
        const champ = CHAMPS_REFERENCE[code] || CHAMPS_REFERENCE.RELANCE;
        $('#aRefL').textContent = champ[0];
        $('#aRef').placeholder = champ[1];
        $('#aRef').classList.toggle('mono', code === 'CREATION_CA');
        $('#aEnvWrap').hidden = code !== 'DEMANDE_REGULARISATION';
        const aide = AIDES_COMMENTAIRE[code] || ['Commentaire', 'Détail de l\'action, réponse de l\'opérateur, consigne au PDV…'];
        $('#aComL').textContent = aide[0];
        $('#aCom').placeholder = aide[1];
        const def = C.ACTIONS_BO.find(function (a) { return a.code === code; });
        $('#aGo').innerHTML = ico(code === 'TERMINE' ? 'circle-check' : code === 'REJETE' ? 'circle-x' : 'check') + (LIBELLES_ENVOI[code] || (def ? 'Enregistrer : ' + def.libelle : 'Enregistrer'));
        $('#aGo').className = 'btn ' + (code === 'TERMINE' ? 'b-ok' : code === 'REJETE' ? 'b-ko' : 'bp');
        icones();
      };
      f.addEventListener('change', function (e) { if (e.target.name === 'code') maj(); });
      const edit = $('#aAgentEdit');
      if (edit) edit.addEventListener('click', function () { $('#aAgentWrap').hidden = false; $('#aAgent').focus(); });
      $$('#pBody [data-pick]').forEach(function (b) {
        b.addEventListener('click', function () {
          choisirAction(b.dataset.pick);
          if (b.dataset.go && memoire.lire(cle('agent'))) f.requestSubmit ? f.requestSubmit() : f.dispatchEvent(new Event('submit', { cancelable: true }));
        });
      });
      if (brouillon) {
        if (brouillon.code) { const r = f.querySelector('[name=code][value="' + brouillon.code + '"]'); if (r) r.checked = true; }
        if (brouillon.ref && f.reference) f.reference.value = brouillon.ref;
        if (brouillon.com) f.commentaire.value = brouillon.com;
      }
      maj();
    } else {
      $$('#pBody [data-focus]').forEach(function (b) { b.addEventListener('click', function () { $('#aCom').focus(); $('#cmpWrap').scrollIntoView({ behavior: 'smooth', block: 'center' }); }); });
      if (brouillon && brouillon.com) f.commentaire.value = brouillon.com;
    }
  }

  function choisirAction(code) {
    const r = $('#fAct [name=code][value="' + code + '"]');
    if (!r) return;
    r.checked = true;
    r.dispatchEvent(new Event('change', { bubbles: true }));
    $('#cmpWrap').scrollIntoView({ behavior: 'smooth', block: 'center' });
    setTimeout(function () {
      const agent = $('#aAgent');
      (agent && !$('#aAgentWrap').hidden && !agent.value ? agent : $('#aCom')).focus({ preventScroll: true });
    }, 250);
  }

  function erreurAction(msg, champ) {
    $('#aErr').hidden = !msg;
    $('#aErr').innerHTML = msg ? ico('circle-alert') + '<span>' + esc(msg) + '</span>' : '';
    icones();
    if (champ) champ.focus();
  }

  async function soumettreAction(e) {
    e.preventDefault();
    const f = $('#fAct');
    const code = (f.querySelector('[name=code]:checked') || f.querySelector('input[type=hidden][name=code]') || {}).value;
    const data = {
      incident_id: S.ouvert,
      code: code,
      reference: f.reference && !$('#aRefWrap').hidden ? f.reference.value.trim() : '',
      date_envoi: f.date_envoi && code === 'DEMANDE_REGULARISATION' ? f.date_envoi.value : '',
      commentaire: f.commentaire.value.trim(),
      // Le point de vente agit en son nom ; seul le Back Office indique l'agent.
      agent: f.agent ? f.agent.value.trim() : moi(),
    };
    erreurAction('');
    if (!code) { erreurAction('Choisissez une action.'); return; }
    if (!data.agent) { $('#aAgentWrap').hidden = false; erreurAction('Indiquez votre nom (agent Back Office).', f.agent); return; }
    if (code === 'CREATION_CA' && !data.reference) { erreurAction('Indiquez le N° du CA.', f.reference); return; }
    if (code === 'DEMANDE_REGULARISATION') {
      if (!data.reference) { erreurAction("Indiquez l'objet du mail envoyé à Alima.", f.reference); return; }
      if (!data.date_envoi) { erreurAction("Indiquez la date d'envoi du mail.", f.date_envoi); return; }
      if (data.date_envoi > cleJour(new Date())) { erreurAction("La date d'envoi ne peut pas être dans le futur.", f.date_envoi); return; }
    }
    if ((!estBO() || COMMENTAIRE_REQUIS.indexOf(code) >= 0) && !data.commentaire) {
      erreurAction(estBO() ? 'Ce commentaire est obligatoire pour cette action.' : 'Écrivez votre message au Back Office.', f.commentaire);
      return;
    }
    await enregistrerAction(data, $('#aGo'));
  }

  async function enregistrerAction(data, bouton) {
    if (bouton) bouton.disabled = true;
    try {
      const r = await Store.addAction(S.session, data);
      if (estBO()) memoire.ecrire(cle('agent'), data.agent);
      const k = S.incidents.findIndex(function (x) { return x.id === r.incident.id; });
      if (k >= 0) S.incidents[k] = r.incident;
      S.actions.push(r.action);
      calculerMeta();
      marquerVu(r.incident.id);
      rendre();
      if (S.ouvert === r.incident.id) rendrePanneau(true);
      toast(estBO() ? r.action.libelle + ' — ' + r.incident.id : 'Message envoyé au Back Office', 'ok');
      return true;
    } catch (ex) {
      if ($('#aErr')) erreurAction(ex.message); else toast(ex.message, 'err');
      if (bouton) bouton.disabled = false;
      return false;
    }
  }

  // Bouton « Prendre en charge » directement depuis la file.
  function actionRapide(id, code, contexte, bouton) {
    const agent = (S.session.user && S.session.user.nom) || memoire.lire(cle('agent'));
    if (!agent) {
      toast('Session Back Office incomplète : reconnectez-vous avec votre code.', 'err');
      return;
    }
    // La prise en charge se fait sans commentaire.
    enregistrerAction({ incident_id: id, code: code, reference: '', commentaire: '', agent: agent }, bouton || null);
  }

  /* ================= Recherche rapide ================= */

  let rechercheSel = 0;

  function initRecherche() {
    $('#cmdk').addEventListener('click', function (e) {
      if (e.target.id === 'cmdk') { fermerRecherche(); return; }
      const b = e.target.closest('[data-res]');
      if (b) { fermerRecherche(); ouvrirPanneau(b.dataset.res, $$('#cmdkRes [data-res]').map(function (x) { return x.dataset.res; })); }
    });
    $('#cmdkQ').addEventListener('input', function () { rechercheSel = 0; rendreRecherche(); });
    $('#cmdkQ').addEventListener('keydown', function (e) {
      const res = $$('#cmdkRes [data-res]');
      if (e.key === 'ArrowDown') { e.preventDefault(); rechercheSel = Math.min(res.length - 1, rechercheSel + 1); majSel(res); }
      if (e.key === 'ArrowUp') { e.preventDefault(); rechercheSel = Math.max(0, rechercheSel - 1); majSel(res); }
      if (e.key === 'Enter' && res[rechercheSel]) { e.preventDefault(); res[rechercheSel].click(); }
    });
  }
  function majSel(res) {
    res.forEach(function (b, k) { b.classList.toggle('on', k === rechercheSel); });
    if (res[rechercheSel]) res[rechercheSel].scrollIntoView({ block: 'nearest' });
  }
  function ouvrirRecherche() {
    $('#cmdk').hidden = false;
    $('#cmdkQ').value = '';
    rechercheSel = 0;
    rendreRecherche();
    setTimeout(function () { $('#cmdkQ').focus(); }, 20);
  }
  function fermerRecherche() { $('#cmdk').hidden = true; }
  function rendreRecherche() {
    const q = $('#cmdkQ').value;
    let res = q.trim() ? rechercher(S.incidents, q) : S.incidents.slice().sort(function (a, b) { return String(b.maj_le).localeCompare(String(a.maj_le)); });
    res = res.slice(0, 10);
    $('#cmdkRes').innerHTML = (q.trim() ? '' : '<div class="hd">Activité récente</div>') + (res.length ? res.map(function (i, k) {
      return '<button type="button" data-res="' + esc(i.id) + '"' + (k === rechercheSel ? ' class="on"' : '') + '>' + icoNature(i) +
        '<span><span class="t">' + (estBO() ? esc(i.pdv) + ' · ' : '') + esc(sousTitre(i)) + ' — ' + fcfa(i.montant) + '</span><br><span class="m mono">' + esc(i.id) + (reference(i) ? ' · ' + esc(reference(i)) : '') + ' · ' + quand(i.cree_le) + '</span></span>' +
        badge(etat(i)) + '</button>';
    }).join('') : '<div class="none">Aucun incident trouvé pour « ' + esc(q) + ' ».</div>');
    icones();
  }

  /* ================= Déclaration (PDV) : assistant pas à pas ================= */

  const TITRES = [null, 'Quel type de paiement ?', "Détails de l'opération", "Que s'est-il passé ?", 'Vérifiez et envoyez', 'C\'est envoyé !'];
  let etapeW = 1;
  let incidentCree = null;

  function initDeclaration() {
    $('#nOps').innerHTML = C.OPERATEURS.map(function (o) {
      return '<label style="--opc:' + esc(o.couleur) + '"><input type="radio" name="operateur" value="' + esc(o.code) + '"><span>' + logoOp(o) + '<b>' + esc(o.nom) + '</b></span></label>';
    }).join('');
    $('#nIncident').innerHTML = C.INCIDENTS_FORMALITE.map(function (x) { return '<label><input type="radio" name="incident" value="' + esc(x) + '"><span>' + esc(x) + '</span></label>'; }).join('');

    $$('#fNew [name=nature]').forEach(function (r) {
      r.addEventListener('change', function () { appliquerNature(r.value); allerA(2); });
    });
    $$('#mNew [data-close]').forEach(function (b) { b.addEventListener('click', fermerDeclaration); });
    $('#mNew').addEventListener('mousedown', function (e) { if (e.target.id === 'mNew') fermerDeclaration(); });
    $('#nPrev').addEventListener('click', function () { if (etapeW === 1) fermerDeclaration(); else allerA(etapeW - 1); });
    $('#nNext').addEventListener('click', suivant);
    $('#nSteps').addEventListener('click', function (e) {
      const li = e.target.closest('li[data-step]');
      if (li && Number(li.dataset.step) < etapeW && etapeW < 5) allerA(Number(li.dataset.step));
    });
    $('#fNew').addEventListener('submit', soumettreDeclaration);
    $('#fNew').addEventListener('input', function (e) {
      const t = e.target;
      if (t.classList) t.classList.remove('err');
      if (t.name === 'operateur') $('#nOps').classList.remove('err');
      if (t.name === 'incident') $('#nIncident').classList.remove('err');
      if (t.id === 'nMontant') {
        const brut = t.value.replace(/\D/g, '').replace(/^0+/, '');
        t.value = brut ? nombre(brut) : '';
      }
      if (t.id === 'nDesc') $('#nDescN').textContent = t.value.length + ' / 2000';
      sauverBrouillon();
      majTicket();
    });
    $('#fNew').addEventListener('change', function (e) {
      if (e.target.name === 'operateur' || e.target.name === 'incident') sauverBrouillon();
      majTicket();
    });
    $('#nQuickDate').addEventListener('click', function (e) {
      const b = e.target.closest('[data-j]');
      if (!b) return;
      $('#nDate').value = cleJour(new Date(Date.now() - Number(b.dataset.j) * 864e5));
      $('#nDate').classList.remove('err');
      majTicket();
    });
    $('#nTpl').addEventListener('click', function (e) {
      const b = e.target.closest('button');
      if (!b) return;
      const d = $('#nDesc');
      d.value = d.value.trim() ? d.value.trim() + ' ' + b.textContent : b.textContent;
      d.classList.remove('err');
      d.focus();
      $('#nDescN').textContent = d.value.length + ' / 2000';
      sauverBrouillon();
    });
    $('#nRecap').addEventListener('click', function (e) {
      const b = e.target.closest('[data-goto]');
      if (b) allerA(Number(b.dataset.goto));
    });
    $('#nOkView').addEventListener('click', function () {
      fermerDeclaration();
      if (incidentCree) ouvrirPanneau(incidentCree);
    });
    $('#nOkAgain').addEventListener('click', function () { ouvrirDeclaration(''); });
  }

  const SOLUTION_PAR_DEFAUT = 'À définir par le Back Office';
  function natureChoisie() { return ($('#fNew [name=nature]:checked') || {}).value || ''; }
  const valeurRadio = function (nom) { return ($('#fNew [name=' + nom + ']:checked') || {}).value || ''; };

  function donneesDeclaration() {
    const f = $('#fNew');
    const n = natureChoisie();
    const formalite = n === 'FORMALITE';
    return {
      categorie: formalite ? 'FORMALITE' : 'MOBILE_MONEY',
      type_operation: formalite ? '' : n,
      operateur: valeurRadio('operateur'),
      date_operation: f.date_operation.value,
      montant: f.montant.value.replace(/\D/g, ''),
      telephone: formalite ? '' : f.telephone.value.trim(),
      reference: formalite ? '' : f.reference.value.trim(),
      incident: formalite ? valeurRadio('incident') : '',
      num_liquidation: formalite ? f.num_liquidation.value.trim() : '',
      formalite: formalite ? f.formalite.value.trim() : '',
      description: f.description.value.trim(),
      // Plus demandée au point de vente : c'est le Back Office qui choisit la solution.
      solution: SOLUTION_PAR_DEFAUT,
      // Pas de nom d'agent à saisir : la déclaration est faite au nom du point de vente.
      declarant: moi(),
    };
  }

  function controlerEtape(k) {
    const f = $('#fNew');
    const d = donneesDeclaration();
    const manquants = [];
    const exiger = function (ok, el, libelle) { if (!ok) { manquants.push(libelle); if (el) el.classList.add('err'); } };
    if (k === 1) exiger(natureChoisie(), null, 'le type de paiement');
    if (k === 2) {
      if (d.categorie === 'FORMALITE') {
        exiger(d.incident, $('#nIncident'), "l'incident survenu");
        exiger(d.num_liquidation, f.num_liquidation, 'le n° de liquidation');
        exiger(d.formalite, f.formalite, 'la formalité voulue');
      } else {
        exiger(d.operateur, $('#nOps'), 'le moyen de paiement');
      }
      if (d.categorie === 'FORMALITE') {
        exiger(d.operateur, $('#nOps'), 'le moyen de paiement');
      }
      exiger(Number(d.montant) > 0, f.montant, 'le montant');
      exiger(d.date_operation, f.date_operation, "la date de l'opération");
      if (d.date_operation && d.date_operation > cleJour(new Date())) { manquants.push("une date d'opération passée"); f.date_operation.classList.add('err'); }
    }
    if (k === 3) {
      exiger(d.description, f.description, "ce qui s'est passé");
    }
    return manquants;
  }

  function erreurDeclaration(msg) {
    $('#nErr').hidden = !msg;
    $('#nErr').innerHTML = msg ? ico('circle-alert') + '<span>' + esc(msg) + '</span>' : '';
    icones();
  }

  function signalerManquants(manquants) {
    erreurDeclaration('À compléter : ' + manquants.join(', ') + '.');
    const premier = $('#fNew .err');
    if (premier) { premier.scrollIntoView({ behavior: 'smooth', block: 'center' }); if (premier.focus) premier.focus({ preventScroll: true }); }
  }

  function suivant() {
    const manquants = controlerEtape(etapeW);
    if (manquants.length) { signalerManquants(manquants); return; }
    allerA(etapeW + 1);
  }

  function allerA(k) {
    etapeW = k;
    erreurDeclaration('');
    $$('#fNew .nstep').forEach(function (s) { s.hidden = Number(s.dataset.step) !== k; });
    $$('#nSteps li').forEach(function (li) {
      const n = Number(li.dataset.step);
      li.className = n < k ? 'fait' : n === k ? 'actif' : '';
      li.querySelector('.stp-n').innerHTML = n < k ? ico('check') : n;
    });
    $('#wzFill').style.width = Math.min(100, (k / 4) * 100) + '%';
    $('#mNewTitle').textContent = TITRES[k];
    $('#wzStepLbl').textContent = k === 5 ? 'Terminé' : 'Étape ' + k + ' sur 4';
    $('#mNew').classList.toggle('wz-ok', k === 5);
    majTicket();
    $('#nPrev').innerHTML = k === 1 ? 'Annuler' : ico('arrow-left') + 'Retour';
    $('#nPrev').hidden = k === 5;
    $('#nNext').hidden = k >= 4;
    $('#nSubmit').hidden = k !== 4;
    $('#nDraft').hidden = k === 5;
    $('#fNew .mdl-ft').hidden = k === 5;
    if (k === 4) rendreRecap();
    icones();
    $('#fNew .mdl-bd').scrollTop = 0;
    const champ = $('#fNew .nstep[data-step="' + k + '"]').querySelector('input:not([type=radio]):not([type=hidden]), textarea');
    if (champ && window.innerWidth > 700 && k !== 2) champ.focus();
    if (k === 2 && window.innerWidth > 700) {
      const premier = natureChoisie() === 'FORMALITE' ? null : $('#fNew [name=operateur]:checked') ? $('#nMontant') : null;
      if (premier) premier.focus();
    }
  }

  function rendreRecap() {
    const d = donneesDeclaration();
    const nat = natureChoisie();
    const n = NATURES[nat];
    const ligne = function (l, v, icone) {
      return '<div class="rc-r"><dt>' + ico(icone) + l + '</dt><dd>' + (v || '<span class="z">Non renseigné</span>') + '</dd></div>';
    };
    const lignes = d.categorie === 'FORMALITE'
      ? [ligne('Incident', esc(d.incident), 'file-warning'), ligne('Formalité voulue', esc(d.formalite), 'file-text'),
        ligne('N° de liquidation', '<span class="mono">' + esc(d.num_liquidation) + '</span>', 'hash'),
        ligne('Moyen de paiement', d.operateur ? pastilleOp(d.operateur) : 'Espèces / autre', 'wallet'),
        ligne("Date de l'opération", fDateOp(d.date_operation), 'calendar')]
      : [ligne('Moyen de paiement', pastilleOp(d.operateur), 'wallet'), ligne("Date de l'opération", fDateOp(d.date_operation), 'calendar'),
        ligne('N° du client', d.telephone ? '<span class="mono">' + esc(d.telephone) + '</span>' : '', 'phone'),
        ligne('Référence', d.reference ? '<span class="mono">' + esc(d.reference) + '</span>' : '', 'hash')];
    const sousTitreRecap = d.categorie === 'FORMALITE' ? 'Paiement de formalité' : 'Mobile Money · ' + (d.operateur ? operateur(d.operateur).nom : '');
    $('#nRecap').innerHTML =
      '<div class="rc-top n-' + nat + '"><span class="rc-nat">' + ico(n.ico) + '</span>' +
      '<div class="rc-tt"><small>' + n.libelle + ' · ' + esc(sousTitreRecap) + '</small><div class="rc-amt">' + nombre(d.montant) + '<small>FCFA</small></div></div>' +
      '<div class="rc-pdv"><small>Point de vente</small><b>' + esc(moi()) + '</b></div></div>' +
      '<div class="rc-grid">' +
      '<div class="rc-sec"><div class="rc-h"><b>' + ico('receipt-text') + 'Opération</b><button type="button" class="rc-e" data-goto="2">' + ico('pencil') + 'Modifier</button></div><dl>' + lignes.join('') + '</dl></div>' +
      '<div class="rc-sec"><div class="rc-h"><b>' + ico('message-square-text') + 'Explication</b><button type="button" class="rc-e" data-goto="3">' + ico('pencil') + 'Modifier</button></div><p class="rc-txt">' + esc(d.description) + '</p></div>' +
      '</div>' +
      '<div class="rc-note">' + ico('send') + '<span>En envoyant, l\'incident est transmis au <b>Back Office</b>. Vous suivrez chaque étape du traitement depuis <b>Mes déclarations</b>.</span></div>';

    // Doublons possibles : même référence / liquidation, ou même opération à quelques heures près.
    const dop = date(d.date_operation);
    const doublons = S.incidents.filter(function (i) {
      if (i.statut === 'REJETE') return false;
      if (d.reference && i.reference && sansAccents(i.reference) === sansAccents(d.reference)) return true;
      if (d.num_liquidation && i.num_liquidation && sansAccents(i.num_liquidation) === sansAccents(d.num_liquidation)) return true;
      const di = date(i.date_operation);
      return nature(i) === natureChoisie() && i.operateur === d.operateur && Number(i.montant) === Number(d.montant) && dop && di && Math.abs(di - dop) < 6 * 36e5;
    });
    $('#nDup').hidden = !doublons.length;
    $('#nDup').innerHTML = doublons.length
      ? ico('triangle-alert') + '<span><b>Déjà déclaré ?</b> ' + doublons.length + ' incident(s) très proche(s) existe(nt) déjà : ' +
        doublons.slice(0, 3).map(function (i) { return '<span class="mono">' + esc(i.id) + '</span> (' + libelleEtat(etat(i)).toLowerCase() + ', ' + fDate(i.cree_le) + ')'; }).join(', ') +
        '. Vérifiez avant d\'envoyer pour éviter un doublon.</span>'
      : '';
  }

  // Ticket récapitulatif affiché en direct à côté de l'assistant.
  function majTicket() {
    const d = donneesDeclaration();
    const n = NATURES[natureChoisie()];
    const op = d.operateur ? operateur(d.operateur) : null;
    $('#tkIco').className = 'tk-i' + (n ? ' n-' + natureChoisie() : '');
    $('#tkIco').innerHTML = ico(n ? n.ico : 'receipt');
    $('#tkNat').textContent = n ? n.libelle + (d.categorie === 'FORMALITE' && d.incident ? ' · ' + d.incident : '') : 'Nouvel incident';
    $('#tkOp').innerHTML = op ? logoOp(op) + esc(op.nom) : (d.categorie === 'FORMALITE' ? esc(d.formalite || 'Formalité à préciser') : 'Moyen de paiement à choisir');
    $('#tkAmt').textContent = Number(d.montant) > 0 ? nombre(d.montant) : '0';
    $('#tkDate').textContent = d.date_operation ? fDateOp(d.date_operation) : '—';
    const ref = d.categorie === 'FORMALITE' ? d.num_liquidation : d.reference;
    $('#tkRef').textContent = ref || (d.categorie === 'FORMALITE' ? 'N° de liquidation à préciser' : 'Référence à préciser');
    $('#tkRef').classList.toggle('z', !ref);
    icones();
  }

  function appliquerNature(n) {
    const formalite = n === 'FORMALITE';
    $('#mNew').classList.toggle('n-mm', !formalite);
    $('#mNew').classList.toggle('n-f', formalite);
    $('#nTpl').innerHTML = (MODELES[n] || []).map(function (t) { return '<button type="button">' + esc(t) + '</button>'; }).join('');
    $('#mNewPdv').textContent = 'Nouvelle déclaration · ' + moi() + ' · ' + NATURES[n].libelle;
  }


  /* Brouillon conservé si l'assistant est fermé avant l'envoi. */
  function sauverBrouillon() {
    if (etapeW >= 5) return;
    const d = donneesDeclaration();
    d.nature = natureChoisie();
    d.montant = $('#nMontant').value;
    memoire.ecrire(cle('brouillon'), d);
    $('#nDraft').innerHTML = ico('save') + 'Brouillon enregistré';
    icones();
  }
  function restaurerBrouillon(b) {
    const f = $('#fNew');
    const radio = function (nom, v) { const r = v !== undefined && f.querySelector('[name=' + nom + '][value="' + String(v).replace(/"/g, '\\"') + '"]'); if (r) r.checked = true; };
    radio('nature', b.nature);
    appliquerNature(b.nature);
    radio('operateur', b.operateur);
    radio('incident', b.incident);
    ['montant', 'telephone', 'reference', 'num_liquidation', 'formalite', 'description', 'date_operation'].forEach(function (k) { if (b[k] && f[k]) f[k].value = b[k]; });
  }

  function ouvrirDeclaration(natureInitiale) {
    if (estBO()) return;
    const f = $('#fNew');
    f.reset();
    $$('.err', f).forEach(function (x) { x.classList.remove('err'); });
    $('#mNew').classList.remove('n-mm', 'n-f');
    $('#mNewPdv').textContent = 'Nouvelle déclaration · ' + moi();
    $('#nDate').value = cleJour(new Date());
    $('#nDate').max = cleJour(new Date());
    $('#nDraft').innerHTML = '';
    $('#nDescN').textContent = '0 / 2000';
    incidentCree = null;
    const formalites = {};
    C.FORMALITES.concat(S.incidents.map(function (i) { return i.formalite; })).forEach(function (x) { if (x) formalites[x] = true; });
    $('#dlFormalites').innerHTML = Object.keys(formalites).sort().map(function (x) { return '<option value="' + esc(x) + '">'; }).join('');
    $('#nSubmit').disabled = false;
    $('#mNew').hidden = false;
    document.body.style.overflow = 'hidden';

    const brouillon = memoire.lire(cle('brouillon'));
    if (!natureInitiale && brouillon && brouillon.nature && (brouillon.description || brouillon.montant || brouillon.reference || brouillon.num_liquidation)) {
      restaurerBrouillon(brouillon);
      allerA(2);
      $('#nDraft').innerHTML = ico('history') + 'Brouillon restauré · <button type="button" class="lnk" id="nDraftClear" style="font-size:12px;padding:0">recommencer</button>';
      icones();
      $('#nDraftClear').addEventListener('click', function () { memoire.effacer(cle('brouillon')); ouvrirDeclaration(''); });
      return;
    }
    if (natureInitiale && NATURES[natureInitiale]) {
      memoire.effacer(cle('brouillon'));
      f.querySelector('[name=nature][value="' + natureInitiale + '"]').checked = true;
      appliquerNature(natureInitiale);
      allerA(2);
    } else {
      allerA(1);
    }
  }

  function fermerDeclaration() {
    if ($('#mNew').hidden) return;
    $('#mNew').hidden = true;
    document.body.style.overflow = '';
  }

  async function soumettreDeclaration(e) {
    e.preventDefault();
    // Entrée dans un champ : on avance d'une étape au lieu d'envoyer.
    if (etapeW < 4) { suivant(); return; }
    if (etapeW !== 4) return;
    for (let k = 1; k < 4; k++) {
      const manquants = controlerEtape(k);
      if (manquants.length) { allerA(k); controlerEtape(k); signalerManquants(manquants); return; }
    }
    $('#nSubmit').disabled = true;
    $('#nSubmit').innerHTML = '<span class="ld-s" style="width:16px;height:16px;border-width:2px"></span>Envoi…';
    try {
      const inc = await Store.create(S.session, donneesDeclaration());
      memoire.effacer(cle('brouillon'));
      S.incidents.push(inc);
      calculerMeta();
      marquerVu(inc.id);
      incidentCree = inc.id;
      $('#nOkId').textContent = inc.id;
      allerA(5);
      rendre();
    } catch (ex) {
      erreurDeclaration(ex.message);
      $('#nSubmit').disabled = false;
      $('#nSubmit').innerHTML = ico('send') + 'Envoyer au Back Office';
      icones();
    }
  }

  /* ================= Export Excel ================= */

  function exporterExcel() {
    if (!window.XLSX) { toast("La bibliothèque Excel n'a pas pu être chargée (connexion internet ?).", 'err'); return; }
    const lignes = S.lignesExport;
    if (!lignes.length) { toast('Aucun incident à exporter avec les filtres actuels.', 'err'); return; }
    const ids = {};
    lignes.forEach(function (i) { ids[i.id] = true; });
    const opNom = function (c) { const o = operateur(c); return o ? o.nom : ''; };
    const feuille = function (rows, largeurs) {
      const ws = XLSX.utils.json_to_sheet(rows);
      ws['!cols'] = largeurs.map(function (w) { return { wch: w }; });
      return ws;
    };
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, feuille(lignes.map(function (i) {
      return {
        'N°': i.id, 'Point de vente': i.pdv, 'Nature': NATURES[nature(i)] ? NATURES[nature(i)].libelle : '',
        'Moyen de paiement': opNom(i.operateur), "Date de l'opération": fDateOp(i.date_operation), 'Montant (FCFA)': Number(i.montant) || 0,
        'N° client': i.telephone, 'Référence transaction': i.reference, 'Incident (formalité)': i.incident,
        'N° liquidation': i.num_liquidation, 'Formalité voulue': i.formalite, "Ce qui s'est passé": i.description,
        'Solution demandée': i.solution, 'État': ETATS[etat(i)].libelle, 'Dernière action': i.derniere_action,
        'Déclarant': i.declarant, 'Déclaré le': fDateHeure(i.cree_le), 'Mis à jour le': fDateHeure(i.maj_le),
        'Clôturé le': i.cloture_le ? fDateHeure(i.cloture_le) : '',
      };
    }), [16, 18, 11, 14, 17, 15, 14, 18, 24, 16, 20, 50, 30, 14, 26, 18, 17, 17, 17]), 'Incidents');

    XLSX.utils.book_append_sheet(wb, feuille(S.actions.filter(function (a) { return ids[a.incident_id]; })
      .sort(function (a, b) { return String(a.cree_le).localeCompare(String(b.cree_le)); })
      .map(function (a) {
        return {
          'N° incident': a.incident_id, 'Date': fDateHeure(a.cree_le), 'Auteur': a.auteur, 'Agent': a.agent,
          'Action': a.libelle, 'Référence / objet du mail': a.reference, "Date d'envoi du mail": a.date_envoi ? fDateOp(a.date_envoi) : '', 'Commentaire': a.commentaire,
          'Statut après': (ETATS[a.statut_apres] || {}).libelle || '',
        };
      }), [16, 17, 16, 18, 28, 36, 16, 60, 12]), 'Actions de suivi');

    if (estBO()) {
      XLSX.utils.book_append_sheet(wb, feuille(C.POINTS_DE_VENTE.map(function (p) {
        const st = stats(lignes.filter(function (i) { return i.pdv === p; }));
        return {
          'Point de vente': p, 'Déclarés': st.n, 'Montant (FCFA)': st.montant, 'Nouveaux': st.NOUVEAU,
          'En traitement': st.EN_COURS + st.ATTENTE, 'Résolus': st.TERMINE, 'Rejetés': st.REJETE, 'Taux de traitement (%)': st.taux,
        };
      }), [20, 10, 16, 10, 14, 10, 10, 20]), 'Synthèse PDV');
    }
    const nom = 'incidents_' + moi().toLowerCase().replace(/[^a-z0-9]+/g, '-') + '_' + cleJour(new Date()) + '.xlsx';
    XLSX.writeFile(wb, nom);
    toast('Export Excel : ' + lignes.length + ' incident(s)', 'ok');
  }

  /* ================= Démarrage ================= */

  // Ouvrir une carte au clavier (Entrée / Espace).
  document.addEventListener('keydown', function (e) {
    if ((e.key === 'Enter' || e.key === ' ') && e.target.classList && e.target.classList.contains('ic')) {
      e.preventDefault();
      e.target.click();
    }
  });

  initConnexion();
  const enregistree = memoire.lire(CLE_SESSION);
  if (Store.configure && enregistree && enregistree.profil) {
    profilChoisi = enregistree.profil;
    connecter(enregistree.profil, enregistree.code || '', true, enregistree.token || '');
  } else {
    afficherConnexion();
  }
})();
