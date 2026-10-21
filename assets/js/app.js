/*
 * Suivi des incidents de paiement — interface (connexion, tableau de bord,
 * déclaration par les points de vente, suivi par le Back Office).
 */
(function () {
  'use strict';
  const C = window.APP_CONFIG;
  const Store = window.Store;
  const BO = C.BACK_OFFICE;

  // Couleurs reprises du thème Flowbite d'iris.
  const STATUTS = {
    NOUVEAU: { libelle: 'Nouveau', pluriel: 'Nouveaux', badge: 'becp', couleur: '#ea580c' },
    EN_COURS: { libelle: 'En cours', pluriel: 'En cours', badge: 'benc', couleur: '#1d4ed8' },
    TERMINE: { libelle: 'Terminé', pluriel: 'Terminés', badge: 'bter', couleur: '#047857' },
    REJETE: { libelle: 'Rejeté', pluriel: 'Rejetés', badge: 'bneg', couleur: '#9333ea' },
  };
  const ORDRE_STATUTS = ['NOUVEAU', 'EN_COURS', 'TERMINE', 'REJETE'];
  const NATURES = {
    DEPOT: { libelle: 'Dépôt', ico: 'arrow-down-to-line', couleur: '#1d4ed8' },
    RETRAIT: { libelle: 'Retrait', ico: 'arrow-up-from-line', couleur: '#0891b2' },
    FORMALITE: { libelle: 'Formalité', ico: 'file-text', couleur: '#ea580c' },
  };
  const PAR_PAGE = 100;
  const CLE_SESSION = 'sip_session';

  const S = {
    session: null,
    incidents: [],
    actions: [],
    filtres: { periode: '30j', du: '', au: '', pdv: '', nature: '', operateur: '', statut: '', q: '', tri: 'recent' },
    limite: PAR_PAGE,
    lignesTable: [],
    charts: {},
    ouvert: null,
    minuteur: null,
    synchro: null,
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
  const nombre = function (n) { return nf.format(Math.round(Number(n) || 0)); };
  const fcfa = function (n) { return nombre(n) + ' FCFA'; };
  const p2 = function (n) { return String(n).padStart(2, '0'); };
  const date = function (v) { const d = v instanceof Date ? v : new Date(v); return isNaN(d) ? null : d; };
  const fDate = function (v) { const d = date(v); return d ? p2(d.getDate()) + '/' + p2(d.getMonth() + 1) + '/' + d.getFullYear() : '—'; };
  const fHeure = function (v) { const d = date(v); return d ? p2(d.getHours()) + ':' + p2(d.getMinutes()) : ''; };
  const fDateHeure = function (v) { const d = date(v); return d ? fDate(d) + ' ' + fHeure(d) : '—'; };
  const cleJour = function (d) { return d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate()); };
  const heuresDepuis = function (v) { const d = date(v); return d ? (Date.now() - d) / 36e5 : 0; };
  const duree = function (h) {
    if (h === null || h === undefined) return '—';
    if (h < 1) return Math.max(1, Math.round(h * 60)) + ' min';
    if (h < 48) return Math.round(h) + ' h';
    return Math.round(h / 24) + ' j';
  };
  const sansAccents = function (s) { return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase(); };
  const nature = function (i) { return i.categorie === 'FORMALITE' ? 'FORMALITE' : i.type_operation; };
  const operateur = function (code) {
    if (!code) return null;
    return C.OPERATEURS.find(function (o) { return o.code === code; }) || { code: code, nom: code, couleur: '#9AA5B4' };
  };
  const estBO = function () { return S.session && S.session.isBO; };
  const parId = function (id) { return S.incidents.find(function (i) { return i.id === id; }); };
  const actionsDe = function (id) {
    return S.actions.filter(function (a) { return a.incident_id === id; })
      .sort(function (a, b) { return String(a.cree_le).localeCompare(String(b.cree_le)); });
  };
  const titreIncident = function (i) {
    if (i.categorie === 'FORMALITE') return 'Formalité — ' + (i.incident || 'incident') + ' — ' + fcfa(i.montant);
    const op = operateur(i.operateur);
    return NATURES[i.type_operation].libelle + ' ' + (op ? op.nom : '') + ' — ' + fcfa(i.montant);
  };

  // Les déclarations se font au nom du point de vente ; les anciennes peuvent porter un nom d'agent.
  const declarePar = function (i) {
    return i.declarant && i.declarant !== i.pdv ? i.declarant + ' — ' + i.pdv : i.pdv;
  };

  const badgeStatut = function (s) {
    const d = STATUTS[s] || STATUTS.NOUVEAU;
    return '<span class="badge ' + d.badge + '">' + d.libelle + '</span>';
  };
  const badgeNature = function (i) {
    const n = NATURES[nature(i)];
    return n ? '<span class="nat-b" style="color:' + n.couleur + '">' + ico(n.ico) + n.libelle + '</span>' : '—';
  };
  const pastilleOp = function (code) {
    const o = operateur(code);
    return o ? '<span class="op"><span class="op-d" style="background:' + esc(o.couleur) + '"></span>' + esc(o.nom) + '</span>' : '<span class="z">—</span>';
  };

  // Icônes Lucide (comme iris) : on pose <i data-lucide>, puis icones() les transforme en SVG.
  const ico = function (nom) { return '<i data-lucide="' + nom + '"></i>'; };
  function icones() {
    if (window.lucide) window.lucide.createIcons();
  }

  let toastTimer = null;
  function toast(msg, type) {
    const t = $('#toast');
    t.textContent = msg;
    t.className = 'toast on ' + (type || '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.className = 'toast'; }, type === 'err' ? 5000 : 3000);
  }
  function chargement(on) { $('#loader').hidden = !on; }

  const memoire = {
    lire: function (k) { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } },
    ecrire: function (k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* mode privé */ } },
    effacer: function (k) { try { localStorage.removeItem(k); } catch (e) { /* mode privé */ } },
  };
  const cleAgent = function () { return 'sip_agent_' + S.session.profil; };

  /* ================= Connexion ================= */

  let profilChoisi = null;

  function initConnexion() {
    $$('[data-cfg]').forEach(function (el) { el.textContent = C[el.dataset.cfg] || ''; });
    document.title = C.APP_TITRE + ' — QFS';
    $('#lgConf').hidden = Store.configure;
    dessinerGrille('');
    icones();
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
    $('#lgBo').addEventListener('click', function () { choisirProfil(BO); });
    $('#lgBack').addEventListener('click', function () { etapeConnexion(1); });
    $('#lgStep2').addEventListener('submit', function (e) {
      e.preventDefault();
      connecter(profilChoisi, $('#lgCode').value.trim());
    });
  }

  function dessinerGrille(q) {
    const n = sansAccents(q).trim();
    const pdvs = C.POINTS_DE_VENTE.filter(function (p) { return !n || sansAccents(p).includes(n); });
    $('#lgGrid').innerHTML = pdvs.length
      ? pdvs.map(function (p) {
        return '<button type="button" class="lg-pdv" data-pdv="' + esc(p) + '"><span class="lg-pin">' + esc(p.charAt(0)) + '</span>' + esc(p) + '</button>';
      }).join('')
      : '<div class="lg-none">Aucun point de vente ne correspond.</div>';
  }

  function etapeConnexion(n) {
    $('#lgStep1').hidden = n !== 1 || !Store.configure;
    $('#lgStep2').hidden = n !== 2;
    $('#lgErr').textContent = '';
    if (n === 2) {
      $('#lgWho').textContent = profilChoisi === BO ? 'Back Office' : profilChoisi;
      $('#lgCode').value = '';
      setTimeout(function () { $('#lgCode').focus(); }, 50);
    }
  }

  function choisirProfil(profil) {
    profilChoisi = profil;
    connecter(profil, '');
  }

  async function connecter(profil, code, silencieux) {
    chargement(true);
    $('#lgErr').textContent = '';
    try {
      const r = await Store.login({ profil: profil, code: code });
      demarrerSession({ profil: r.profil || profil, code: code, isBO: (r.profil || profil) === BO });
    } catch (err) {
      if (silencieux) { afficherConnexion(); return; }
      if (err.code === 'CODE_REQUIS') {
        etapeConnexion(2);
      } else {
        if (err.code === 'CODE_INVALIDE') etapeConnexion(2);
        $('#lgErr').textContent = err.message;
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
  }

  function demarrerSession(sess) {
    S.session = sess;
    memoire.ecrire(CLE_SESSION, { profil: sess.profil, code: sess.code });
    document.body.className = sess.isBO ? 'is-bo' : 'is-pdv';
    $('#login').hidden = true;
    $('#app').hidden = false;
    initApp();
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
    memoire.effacer(CLE_SESSION);
    fermerPanneau();
    S.session = null;
    S.incidents = [];
    S.actions = [];
    S.filtres = { periode: '30j', du: '', au: '', pdv: '', nature: '', operateur: '', statut: '', q: '', tri: 'recent' };
    afficherConnexion();
    window.scrollTo(0, 0);
    toast(message || 'Vous êtes déconnecté.', message ? 'err' : 'ok');
  }

  /* ================= Application ================= */

  let appInitialisee = false;

  function initApp() {
    const bo = estBO();
    $('#sbAv').textContent = bo ? 'BO' : S.session.profil.charAt(0);
    $('#sbAv').className = 'sb-av' + (bo ? ' bo' : '');
    $('#sbName').textContent = bo ? 'Back Office' : S.session.profil;
    $('#sbRole').textContent = bo ? 'Supervision des ' + C.POINTS_DE_VENTE.length + ' PDV' : 'Point de vente';
    $('#sbReg').textContent = bo ? 'Registre des incidents' : 'Mes déclarations';
    $('#bcWho').textContent = bo ? 'Back Office' : S.session.profil;
    $('#pgIco').innerHTML = ico(bo ? 'shield-check' : 'store');
    $('#pgEyebrow').textContent = bo ? 'E-Money · Back Office' : 'E-Money · Point de vente ' + S.session.profil;
    $('#regTitle').textContent = bo ? 'Registre des incidents — tous les points de vente' : 'Mes déclarations';
    $('#ftText').textContent = 'Quipux Financial Services — ' + C.APP_TITRE + ' · ' + new Date().getFullYear();
    icones();

    $('#fPdv').innerHTML = '<option value="">Tous les points de vente</option>' +
      C.POINTS_DE_VENTE.map(function (p) { return '<option>' + esc(p) + '</option>'; }).join('');
    $('#fOp').innerHTML = '<option value="">Tous</option>' +
      C.OPERATEURS.map(function (o) { return '<option value="' + esc(o.code) + '">' + esc(o.nom) + '</option>'; }).join('');
    synchroniserFiltres();

    if (appInitialisee) return;
    appInitialisee = true;

    const surFiltre = function () { S.limite = PAR_PAGE; rendre(); };
    $('#fPeriode').addEventListener('change', function (e) {
      S.filtres.periode = e.target.value;
      $('#fDates').hidden = e.target.value !== 'perso';
      surFiltre();
    });
    $('#fDu').addEventListener('change', function (e) { S.filtres.du = e.target.value; surFiltre(); });
    $('#fAu').addEventListener('change', function (e) { S.filtres.au = e.target.value; surFiltre(); });
    $('#fPdv').addEventListener('change', function (e) { S.filtres.pdv = e.target.value; surFiltre(); });
    $('#fNature').addEventListener('change', function (e) { S.filtres.nature = e.target.value; surFiltre(); });
    $('#fOp').addEventListener('change', function (e) { S.filtres.operateur = e.target.value; surFiltre(); });
    $('#fReset').addEventListener('click', function () {
      Object.assign(S.filtres, { periode: '30j', du: '', au: '', pdv: '', nature: '', operateur: '', statut: '', q: '' });
      synchroniserFiltres();
      surFiltre();
    });
    $('#srch').addEventListener('input', function (e) { S.filtres.q = e.target.value; S.limite = PAR_PAGE; rendreTable(filtrer()); });
    $('#tri').addEventListener('change', function (e) { S.filtres.tri = e.target.value; rendreTable(filtrer()); });
    $('#chips').addEventListener('click', function (e) {
      const b = e.target.closest('[data-s]');
      if (!b) return;
      S.filtres.statut = b.dataset.s;
      S.limite = PAR_PAGE;
      rendreTable(filtrer());
    });
    $('#btnMore').addEventListener('click', function () { S.limite += PAR_PAGE; rendreTable(filtrer()); });
    $('#tbody').addEventListener('click', function (e) {
      const tr = e.target.closest('tr[data-id]');
      if (tr) ouvrirPanneau(tr.dataset.id);
    });
    $('#tSynth tbody').addEventListener('click', function (e) {
      const tr = e.target.closest('tr[data-pdv]');
      if (!tr) return;
      S.filtres.pdv = tr.dataset.pdv;
      $('#fPdv').value = tr.dataset.pdv;
      surFiltre();
      window.scrollTo({ top: 0, behavior: 'smooth' });
      toast('Filtre appliqué : ' + tr.dataset.pdv);
    });
    $('#alerts').addEventListener('click', function (e) {
      const c = e.target.closest('[data-id]');
      if (c) ouvrirPanneau(c.dataset.id);
    });

    $('#btnNew').addEventListener('click', ouvrirDeclaration);
    $('#sbNew').addEventListener('click', function () { menu(false); ouvrirDeclaration(); });
    $('#sbToggle').addEventListener('click', function () { menu(!document.body.classList.contains('sb-open')); });
    $('#sbOv').addEventListener('click', function () { menu(false); });
    $('#sbNav').addEventListener('click', function (e) {
      const a = e.target.closest('a.sb-a');
      if (!a) return;
      $$('#sbNav .sb-a').forEach(function (x) { x.classList.toggle('on', x === a); });
      menu(false);
    });
    $('#btnRefresh').addEventListener('click', function () { actualiser(); });
    $('#btnXlsx').addEventListener('click', exporterExcel);
    $('#btnPrint').addEventListener('click', function () { window.print(); });
    $('#btnLogout').addEventListener('click', function () { deconnecter(); });

    $('#ov').addEventListener('click', fermerPanneau);
    $('#pClose').addEventListener('click', fermerPanneau);
    document.addEventListener('keydown', function (e) {
      if (e.key !== 'Escape') return;
      if (!$('#mNew').hidden) fermerDeclaration();
      else fermerPanneau();
    });
    initDeclaration();
  }

  // Barre latérale repliable sur tablette et téléphone.
  function menu(ouvert) {
    document.body.classList.toggle('sb-open', ouvert);
  }

  function synchroniserFiltres() {
    const f = S.filtres;
    $('#fPeriode').value = f.periode;
    $('#fDates').hidden = f.periode !== 'perso';
    $('#fDu').value = f.du;
    $('#fAu').value = f.au;
    $('#fPdv').value = f.pdv;
    $('#fNature').value = f.nature;
    $('#fOp').value = f.operateur;
    $('#srch').value = f.q;
    $('#tri').value = f.tri;
  }

  async function actualiser(silencieux) {
    if (!silencieux) chargement(true);
    try {
      const r = await Store.list(S.session);
      S.incidents = r.incidents || [];
      S.actions = r.actions || [];
      S.synchro = new Date();
      rendre();
      if (S.ouvert) rendrePanneau();
    } catch (err) {
      if (err.code === 'CODE_INVALIDE' || err.code === 'CODE_REQUIS' || err.code === 'PROFIL_INCONNU') {
        deconnecter('Session expirée : ' + err.message);
      } else if (!silencieux) {
        toast(err.message, 'err');
      }
    } finally {
      if (!silencieux) chargement(false);
    }
  }

  /* ================= Filtres ================= */

  function bornes() {
    const f = S.filtres;
    const now = new Date();
    const jour = function (d) { return new Date(d.getFullYear(), d.getMonth(), d.getDate()); };
    let du = null;
    let au = null;
    switch (f.periode) {
      case 'jour': du = jour(now); break;
      case '7j': du = jour(new Date(now - 6 * 864e5)); break;
      case '30j': du = jour(new Date(now - 29 * 864e5)); break;
      case 'mois': du = new Date(now.getFullYear(), now.getMonth(), 1); break;
      case 'mois_prec':
        du = new Date(now.getFullYear(), now.getMonth() - 1, 1);
        au = new Date(now.getFullYear(), now.getMonth(), 1);
        break;
      case 'perso':
        if (f.du) du = new Date(f.du + 'T00:00');
        if (f.au) { au = new Date(f.au + 'T00:00'); au.setDate(au.getDate() + 1); }
        break;
      default: break;
    }
    return { du: du, au: au };
  }

  function libellePeriode() {
    const b = bornes();
    if (!b.du && !b.au) return 'Toute la période';
    const fin = b.au ? new Date(b.au - 864e5) : new Date();
    if (b.du && cleJour(b.du) === cleJour(fin)) return 'Le ' + fDate(b.du);
    return (b.du ? 'Du ' + fDate(b.du) : 'Jusqu\'au') + ' au ' + fDate(fin);
  }

  function filtrer(options) {
    const f = S.filtres;
    const b = bornes();
    const ignorerPdv = options && options.ignorerPdv;
    return S.incidents.filter(function (i) {
      const d = date(i.cree_le);
      if (b.du && d < b.du) return false;
      if (b.au && d >= b.au) return false;
      if (!ignorerPdv && f.pdv && i.pdv !== f.pdv) return false;
      if (f.nature && nature(i) !== f.nature) return false;
      if (f.operateur && i.operateur !== f.operateur) return false;
      return true;
    });
  }

  function stats(liste) {
    const s = { n: liste.length, montant: 0, montantOuvert: 0, delais: [] };
    ORDRE_STATUTS.forEach(function (k) { s[k] = 0; });
    liste.forEach(function (i) {
      const m = Number(i.montant) || 0;
      s.montant += m;
      s[i.statut] = (s[i.statut] || 0) + 1;
      if (i.statut === 'NOUVEAU' || i.statut === 'EN_COURS') s.montantOuvert += m;
      if (i.statut === 'TERMINE' && i.cloture_le) s.delais.push((date(i.cloture_le) - date(i.cree_le)) / 36e5);
    });
    s.traites = s.TERMINE + s.REJETE;
    s.taux = s.n ? Math.round((s.traites / s.n) * 100) : 0;
    s.delaiMoyen = s.delais.length ? s.delais.reduce(function (a, b) { return a + b; }, 0) / s.delais.length : null;
    return s;
  }

  /* ================= Rendu ================= */

  function rendre() {
    const liste = filtrer();
    const st = stats(liste);
    $('#pgMeta').textContent = 'Période : ' + libellePeriode() +
      (S.filtres.pdv ? ' · Point de vente : ' + S.filtres.pdv : '') +
      ' · Mis à jour à ' + fHeure(S.synchro);
    $('#shPeriode').textContent = libellePeriode();
    $('#tbSync').textContent = 'Données du ' + fDateHeure(S.synchro);
    rendreProgression(st);
    rendreKpis(st);
    rendreGraphiques(liste);
    rendreTable(liste);
    if (estBO()) rendreSynthese(filtrer({ ignorerPdv: true }));
    rendreAlertes(liste);
    icones();
  }

  function rendreProgression(st) {
    const segs = ['TERMINE', 'REJETE', 'EN_COURS', 'NOUVEAU'];
    $('#gPct').textContent = st.taux + '%';
    $('#swrap').innerHTML = segs.map(function (k) {
      const w = st.n ? (st[k] / st.n) * 100 : 0;
      return '<div class="seg" style="width:' + w + '%;background:' + STATUTS[k].couleur + '" title="' + STATUTS[k].pluriel + ' : ' + st[k] + '"></div>';
    }).join('');
    $('#sLegend').innerHTML = segs.map(function (k) {
      return '<span class="sli"><span class="sd" style="background:' + STATUTS[k].couleur + '"></span>' + STATUTS[k].pluriel + ' : <b>' + st[k] + '</b></span>';
    }).join('');
    $('#psum').textContent = st.n
      ? st.traites + ' incident(s) traité(s) sur ' + st.n + ' déclaré(s) — ' + (st.NOUVEAU + st.EN_COURS) + ' encore ouvert(s) pour un montant de ' + fcfa(st.montantOuvert) + '.'
      : 'Aucun incident déclaré sur la période sélectionnée.';
  }

  function rendreKpis(st) {
    const k = function (icone, label, val, unite, couleur) {
      return '<div class="kc" style="--kc:' + couleur + '"><div class="kbi">' + ico(icone) + '</div><p class="kl">' + label + '</p>' +
        '<p class="kv">' + val + '</p><p class="ku">' + unite + '</p></div>';
    };
    const enRetard = filtrer().filter(function (i) { return i.statut === 'NOUVEAU' && heuresDepuis(i.cree_le) >= C.SEUIL_ALERTE_HEURES; }).length;
    $('#kpis').innerHTML = [
      k('clipboard-list', estBO() ? 'Incidents déclarés' : 'Incidents déclarés par mon PDV', nombre(st.n), 'sur la période', '#1d4ed8'),
      k('wallet', 'Montant total concerné', nombre(st.montant), 'FCFA — dont ' + nombre(st.montantOuvert) + ' encore ouverts', '#111827'),
      k('inbox', 'En attente de prise en charge', nombre(st.NOUVEAU), enRetard ? enRetard + ' depuis plus de ' + C.SEUIL_ALERTE_HEURES + ' h' : 'statut « Nouveau »', '#ea580c'),
      k('loader', 'En cours de traitement', nombre(st.EN_COURS), 'CA, régularisation, relance…', '#0891b2'),
      k('circle-check', 'Terminés', nombre(st.TERMINE), st.taux + '% traités (rejetés inclus : ' + st.REJETE + ')', '#047857'),
      k('timer', 'Délai moyen de résolution', duree(st.delaiMoyen), 'de la déclaration à la clôture', '#be123c'),
    ].join('');
  }

  function graphique(id, config) {
    const ex = S.charts[id];
    if (ex) {
      ex.data = config.data;
      ex.options = config.options;
      ex.update();
      return;
    }
    if (!window.Chart) return;
    S.charts[id] = new Chart(document.getElementById(id), config);
  }

  function rendreGraphiques(liste) {
    if (!window.Chart) return;
    Chart.defaults.font.family = "'Public Sans', ui-sans-serif, system-ui, sans-serif";
    Chart.defaults.font.size = 12;
    Chart.defaults.color = '#6b7280';
    Chart.defaults.borderColor = '#f3f4f6';
    const legende = { position: 'bottom', labels: { boxWidth: 10, boxHeight: 10, usePointStyle: true, pointStyle: 'rectRounded', padding: 14 } };
    const tipFcfa = { callbacks: { label: function (c) { return ' ' + c.label + ' : ' + fcfa(c.raw); } } };

    // Par opérateur, empilé par statut
    const ops = C.OPERATEURS.map(function (o) { return o.code; });
    graphique('cOp', {
      type: 'bar',
      data: {
        labels: C.OPERATEURS.map(function (o) { return o.nom; }),
        datasets: ORDRE_STATUTS.map(function (s) {
          return {
            label: STATUTS[s].pluriel,
            backgroundColor: STATUTS[s].couleur,
            borderRadius: 4,
            data: ops.map(function (op) { return liste.filter(function (i) { return i.operateur === op && i.statut === s; }).length; }),
          };
        }),
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: legende },
        scales: { x: { stacked: true, grid: { display: false } }, y: { stacked: true, beginAtZero: true, ticks: { precision: 0 } } },
      },
    });

    // Répartition par statut
    const st = stats(liste);
    graphique('cStatut', {
      type: 'doughnut',
      data: {
        labels: ORDRE_STATUTS.map(function (s) { return STATUTS[s].pluriel; }),
        datasets: [{ data: ORDRE_STATUTS.map(function (s) { return st[s]; }), backgroundColor: ORDRE_STATUTS.map(function (s) { return STATUTS[s].couleur; }), borderWidth: 2, borderColor: '#fff' }],
      },
      options: { responsive: true, maintainAspectRatio: false, cutout: '62%', plugins: { legend: legende } },
    });

    // Évolution : déclarations et traitements par jour (par mois au-delà de 62 jours)
    const b = bornes();
    let debut = b.du;
    if (!debut) {
      const dates = liste.map(function (i) { return date(i.cree_le); });
      debut = dates.length ? new Date(Math.min.apply(null, dates)) : new Date();
    }
    const fin = b.au ? new Date(b.au - 1) : new Date();
    const parMois = (fin - debut) / 864e5 > 62;
    const cle = function (d) { return parMois ? d.getFullYear() + '-' + p2(d.getMonth() + 1) : cleJour(d); };
    const etiquettes = [];
    const cur = new Date(debut.getFullYear(), debut.getMonth(), parMois ? 1 : debut.getDate());
    while (cur <= fin && etiquettes.length < 400) {
      etiquettes.push(cle(cur));
      if (parMois) cur.setMonth(cur.getMonth() + 1); else cur.setDate(cur.getDate() + 1);
    }
    const compte = function (champ, filtre) {
      const m = {};
      liste.forEach(function (i) {
        if (filtre && !filtre(i)) return;
        const d = date(i[champ]);
        if (d) m[cle(d)] = (m[cle(d)] || 0) + 1;
      });
      return etiquettes.map(function (k) { return m[k] || 0; });
    };
    graphique('cEvol', {
      type: 'line',
      data: {
        labels: etiquettes.map(function (k) { const x = k.split('-'); return parMois ? x[1] + '/' + x[0] : x[2] + '/' + x[1]; }),
        datasets: [
          { label: 'Déclarés', data: compte('cree_le'), borderColor: '#ea580c', backgroundColor: 'rgba(234,88,12,.10)', fill: true, cubicInterpolationMode: 'monotone', pointRadius: 2, borderWidth: 2 },
          { label: 'Traités (terminés / rejetés)', data: compte('cloture_le', function (i) { return i.statut === 'TERMINE' || i.statut === 'REJETE'; }), borderColor: '#047857', backgroundColor: 'rgba(4,120,87,.08)', fill: true, cubicInterpolationMode: 'monotone', pointRadius: 2, borderWidth: 2 },
        ],
      },
      options: {
        responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
        plugins: { legend: legende },
        scales: { x: { grid: { display: false }, ticks: { maxRotation: 0, autoSkip: true, maxTicksLimit: 12 } }, y: { beginAtZero: true, ticks: { precision: 0 } } },
      },
    });

    // Montant par nature
    const natures = Object.keys(NATURES);
    graphique('cNature', {
      type: 'doughnut',
      data: {
        labels: natures.map(function (n) { return NATURES[n].libelle; }),
        datasets: [{
          data: natures.map(function (n) { return liste.filter(function (i) { return nature(i) === n; }).reduce(function (s, i) { return s + (Number(i.montant) || 0); }, 0); }),
          backgroundColor: natures.map(function (n) { return NATURES[n].couleur; }), borderWidth: 2, borderColor: '#fff',
        }],
      },
      options: { responsive: true, maintainAspectRatio: false, cutout: '62%', plugins: { legend: legende, tooltip: tipFcfa } },
    });

    // Back Office : par point de vente
    if (estBO()) {
      const lp = filtrer({ ignorerPdv: true });
      const pdvs = C.POINTS_DE_VENTE.map(function (p) { return { p: p, n: lp.filter(function (i) { return i.pdv === p; }).length }; })
        .filter(function (x) { return x.n > 0; })
        .sort(function (a, b2) { return b2.n - a.n; })
        .map(function (x) { return x.p; });
      $('#cPdvWrap').style.height = Math.max(160, pdvs.length * 26 + 70) + 'px';
      graphique('cPdv', {
        type: 'bar',
        data: {
          labels: pdvs,
          datasets: ORDRE_STATUTS.map(function (s) {
            return {
              label: STATUTS[s].pluriel, backgroundColor: STATUTS[s].couleur, borderRadius: 3,
              data: pdvs.map(function (p) { return lp.filter(function (i) { return i.pdv === p && i.statut === s; }).length; }),
            };
          }),
        },
        options: {
          indexAxis: 'y', responsive: true, maintainAspectRatio: false,
          plugins: { legend: legende },
          scales: { x: { stacked: true, beginAtZero: true, ticks: { precision: 0 } }, y: { stacked: true, grid: { display: false } } },
        },
      });
    }
  }

  function rendreTable(liste) {
    const f = S.filtres;
    let lignes = liste;
    if (f.q) {
      const q = sansAccents(f.q).trim();
      lignes = lignes.filter(function (i) {
        return sansAccents([i.id, i.pdv, i.reference, i.num_liquidation, i.telephone, i.description, i.formalite, i.incident, i.declarant, i.solution].join(' ')).includes(q);
      });
    }
    const comptes = { '': lignes.length };
    ORDRE_STATUTS.forEach(function (s) { comptes[s] = lignes.filter(function (i) { return i.statut === s; }).length; });
    $('#chips').innerHTML = [['', 'Tous']].concat(ORDRE_STATUTS.map(function (s) { return [s, STATUTS[s].pluriel]; })).map(function (c) {
      return '<button class="fb' + (f.statut === c[0] ? ' on' : '') + '" data-s="' + c[0] + '">' + c[1] + '<i>' + comptes[c[0]] + '</i></button>';
    }).join('');
    if (f.statut) lignes = lignes.filter(function (i) { return i.statut === f.statut; });

    const tris = {
      recent: function (a, b) { return String(b.cree_le).localeCompare(String(a.cree_le)); },
      ancien: function (a, b) { return String(a.cree_le).localeCompare(String(b.cree_le)); },
      montant: function (a, b) { return (Number(b.montant) || 0) - (Number(a.montant) || 0); },
      maj: function (a, b) { return String(b.maj_le).localeCompare(String(a.maj_le)); },
    };
    lignes = lignes.slice().sort(tris[f.tri] || tris.recent);
    S.lignesTable = lignes;

    const visibles = lignes.slice(0, S.limite);
    $('#tbody').innerHTML = visibles.map(function (i) {
      const age = heuresDepuis(i.cree_le);
      const ouvert = i.statut === 'NOUVEAU' || i.statut === 'EN_COURS';
      const enRetard = i.statut === 'NOUVEAU' && age >= C.SEUIL_ALERTE_HEURES;
      const ref = i.categorie === 'FORMALITE' ? i.num_liquidation : i.reference;
      return '<tr data-id="' + esc(i.id) + '"' + (enRetard ? ' class="late"' : '') + '>' +
        '<td><span class="ib">' + esc(i.id) + '</span></td>' +
        '<td class="nw">' + fDateHeure(i.date_operation) + '<div class="sub">déclaré le ' + fDate(i.cree_le) + '</div></td>' +
        '<td class="bo-only"><b>' + esc(i.pdv) + '</b></td>' +
        '<td>' + badgeNature(i) + (i.categorie === 'FORMALITE' ? '<div class="sub">' + esc(i.incident) + '</div>' : '') + '</td>' +
        '<td>' + pastilleOp(i.operateur) + '</td>' +
        '<td class="mono">' + (ref ? esc(ref) : '<span class="z">—</span>') + (i.categorie === 'FORMALITE' ? '<div class="sub">' + esc(i.formalite) + '</div>' : '') + '</td>' +
        '<td class="num"><b>' + nombre(i.montant) + '</b></td>' +
        '<td class="clip">' + esc(i.solution) + '</td>' +
        '<td>' + badgeStatut(i.statut) + '</td>' +
        '<td>' + esc(i.derniere_action) + '<div class="sub">' + fDateHeure(i.maj_le) + '</div></td>' +
        '<td>' + (ouvert ? (enRetard ? '<span class="adys">' + duree(age) + '</span>' : duree(age)) : '<span class="z">clôturé</span>') + '</td>' +
        '</tr>';
    }).join('');
    $('#nd').hidden = lignes.length > 0;
    $('#more').hidden = lignes.length <= S.limite;
    $('#rc').textContent = lignes.length + ' incident(s) — ' + fcfa(lignes.reduce(function (s, i) { return s + (Number(i.montant) || 0); }, 0));
  }

  function rendreSynthese(liste) {
    const lignes = C.POINTS_DE_VENTE.map(function (p) {
      const l = liste.filter(function (i) { return i.pdv === p; });
      const st = stats(l);
      const attente = l.filter(function (i) { return i.statut === 'NOUVEAU' || i.statut === 'EN_COURS'; })
        .reduce(function (m, i) { return Math.max(m, heuresDepuis(i.cree_le)); }, -1);
      return { p: p, st: st, attente: attente };
    }).sort(function (a, b) { return b.st.n - a.st.n || a.p.localeCompare(b.p); });
    const z = function (n) { return n ? nombre(n) : '<span class="z">0</span>'; };
    $('#tSynth tbody').innerHTML = lignes.map(function (x) {
      const st = x.st;
      const couleur = st.taux >= 75 ? '#047857' : st.taux >= 40 ? '#ea580c' : '#be123c';
      return '<tr data-pdv="' + esc(x.p) + '" title="Filtrer sur ' + esc(x.p) + '">' +
        '<td><b>' + esc(x.p) + '</b></td>' +
        '<td class="num">' + z(st.n) + '</td>' +
        '<td class="num">' + (st.montant ? nombre(st.montant) : '<span class="z">0</span>') + '</td>' +
        '<td class="num">' + z(st.NOUVEAU) + '</td>' +
        '<td class="num">' + z(st.EN_COURS) + '</td>' +
        '<td class="num">' + z(st.TERMINE) + '</td>' +
        '<td class="num">' + z(st.REJETE) + '</td>' +
        '<td>' + (st.n ? '<div class="pb"><div class="pbt"><div class="pbf" style="width:' + st.taux + '%;background:' + couleur + '"></div></div><span class="pbp" style="color:' + couleur + '">' + st.taux + '%</span></div>' : '<span class="z">—</span>') + '</td>' +
        '<td>' + (x.attente >= 0 ? (x.attente >= C.SEUIL_ALERTE_HEURES ? '<span class="adys">' + duree(x.attente) + '</span>' : duree(x.attente)) : '<span class="z">—</span>') + '</td>' +
        '</tr>';
    }).join('');
  }

  function rendreAlertes(liste) {
    const carte = function (i, haut, detail) {
      return '<div class="acard" data-id="' + esc(i.id) + '">' +
        '<div class="aid2"><span class="ib">' + esc(i.id) + '</span>' + (estBO() ? '<b style="font-size:12px;color:#111827">' + esc(i.pdv) + '</b>' : '') + badgeStatut(i.statut) + '</div>' +
        (haut || '') + '<div class="anm">' + esc(titreIncident(i)) + '</div>' +
        (detail ? '<div class="adet">' + detail + '</div>' : '') + '</div>';
    };
    const bloc = function (cls, icone, titre, sous, cartes, vide, total) {
      return '<div class="ac ' + cls + '"><div class="ach"><div class="aic">' + ico(icone) + '</div><div><h3 class="act">' + titre + '</h3><p class="acs">' + sous + '</p></div></div>' +
        (cartes.length ? cartes.join('') : '<div class="aempty">' + ico('circle-check') + vide + '</div>') +
        (total > cartes.length ? '<div class="amore">… et ' + (total - cartes.length) + ' autre(s) dans le registre</div>' : '') + '</div>';
    };

    const retard = liste.filter(function (i) { return i.statut === 'NOUVEAU' && heuresDepuis(i.cree_le) >= C.SEUIL_ALERTE_HEURES; })
      .sort(function (a, b) { return String(a.cree_le).localeCompare(String(b.cree_le)); });
    const gros = liste.filter(function (i) { return (i.statut === 'NOUVEAU' || i.statut === 'EN_COURS') && Number(i.montant) >= C.SEUIL_MONTANT_ELEVE; })
      .sort(function (a, b) { return b.montant - a.montant; });
    const ids = {};
    liste.forEach(function (i) { ids[i.id] = true; });
    const recentes = S.actions.filter(function (a) { return ids[a.incident_id] && (estBO() || a.auteur === BO); })
      .sort(function (a, b) { return String(b.cree_le).localeCompare(String(a.cree_le)); });

    $('#alerts').innerHTML = [
      bloc('crit', 'octagon-alert', 'Non pris en charge depuis plus de ' + C.SEUIL_ALERTE_HEURES + ' h',
        retard.length + ' incident(s) toujours au statut « Nouveau »',
        retard.slice(0, 6).map(function (i) { return carte(i, '', 'Déclaré le ' + fDateHeure(i.cree_le) + ' — <span class="adys">' + duree(heuresDepuis(i.cree_le)) + '</span>'); }),
        'Aucun incident en retard de prise en charge', retard.length),
      bloc('urg', 'banknote', 'Montants élevés non résolus',
        'Incidents ouverts ≥ ' + fcfa(C.SEUIL_MONTANT_ELEVE),
        gros.slice(0, 6).map(function (i) { return carte(i, '', '<span class="amt">' + fcfa(i.montant) + '</span> — ' + esc(i.derniere_action)); }),
        'Aucun montant élevé en attente', gros.length),
      bloc('info', 'message-square-text', estBO() ? 'Dernières actions de suivi' : 'Dernières réponses du Back Office',
        estBO() ? 'Actions du Back Office et compléments des PDV' : 'Suivi de vos déclarations',
        recentes.slice(0, 6).map(function (a) {
          const i = parId(a.incident_id);
          return i ? carte(i, '', '<b>' + esc(a.libelle) + '</b> — ' + fDateHeure(a.cree_le) + (a.commentaire ? '<br>' + esc(a.commentaire) : '')) : '';
        }).filter(Boolean),
        'Aucune action récente', recentes.length),
    ].join('');
  }

  /* ================= Panneau de détail ================= */

  function ouvrirPanneau(id) {
    S.ouvert = id;
    rendrePanneau();
    rendreFormulaireAction();
    $('#ov').classList.add('on');
    $('#pnl').classList.add('on');
    $('#pnl').setAttribute('aria-hidden', 'false');
    $('#pnl .pbd').scrollTop = 0;
  }

  function fermerPanneau() {
    S.ouvert = null;
    $('#ov').classList.remove('on');
    $('#pnl').classList.remove('on');
    $('#pnl').setAttribute('aria-hidden', 'true');
  }

  function rendrePanneau() {
    const i = parId(S.ouvert);
    if (!i) { fermerPanneau(); return; }
    $('#pId').textContent = i.id + ' · ' + i.pdv;
    $('#pTitle').textContent = titreIncident(i);
    const it = function (l, v, large) {
      return '<div class="pi' + (large ? ' w' : '') + '"><div class="pil">' + l + '</div><div class="piv">' + (v || '<span class="z">—</span>') + '</div></div>';
    };
    const ouvert = i.statut === 'NOUVEAU' || i.statut === 'EN_COURS';
    const champs = i.categorie === 'FORMALITE'
      ? [
        it('Nature', badgeNature(i)), it('Incident survenu', esc(i.incident)),
        it('N° de liquidation', esc(i.num_liquidation)), it('Formalité voulue', esc(i.formalite)),
        it('Montant', fcfa(i.montant)), it('Moyen de paiement', i.operateur ? pastilleOp(i.operateur) : ''),
        it("Date de l'opération", fDateHeure(i.date_operation)), it('Solution demandée', esc(i.solution)),
      ]
      : [
        it('Nature', badgeNature(i)), it('Opérateur', pastilleOp(i.operateur)),
        it('Montant', fcfa(i.montant)), it("Date de l'opération", fDateHeure(i.date_operation)),
        it('N° client', esc(i.telephone)), it('Référence transaction', esc(i.reference)),
        it('Solution demandée', esc(i.solution), true),
      ];
    champs.push(it('Déclaré par', esc(declarePar(i))), it('Déclaré le', fDateHeure(i.cree_le)));

    const tl = ['<div class="tli"><div class="tld start"></div><div class="tdt">' + fDateHeure(i.cree_le) + '</div>' +
      '<div class="tdh">Déclaration de l\'incident</div><div class="tdd">par ' + esc(declarePar(i)) + '</div></div>'];
    actionsDe(i.id).forEach(function (a) {
      const cls = a.code === 'TERMINE' ? 'done'
        : a.code === 'REJETE' ? 'blocked'
          : (a.code === 'COMPLEMENT' || a.code === 'COMMENTAIRE') ? 'note' : 'ongoing';
      tl.push('<div class="tli"><div class="tld ' + cls + '"></div><div class="tdt">' + fDateHeure(a.cree_le) + ' — ' +
        esc(a.auteur === BO ? 'Back Office' : a.auteur) + (a.agent && a.agent !== a.auteur ? ' · ' + esc(a.agent) : '') + '</div>' +
        '<div class="tdh">' + esc(a.libelle) + '</div>' +
        (a.reference ? '<span class="tdr">Réf. ' + esc(a.reference) + '</span>' : '') +
        (a.commentaire ? '<div class="tdd">' + esc(a.commentaire) + '</div>' : '') + '</div>');
    });

    $('#pBody').innerHTML =
      '<div class="pst-row">' + badgeStatut(i.statut) +
      (ouvert ? '<span class="adys">ouvert depuis ' + duree(heuresDepuis(i.cree_le)) + '</span>'
        : (i.cloture_le ? '<span class="sub">Clôturé le ' + fDateHeure(i.cloture_le) + ' (en ' + duree((date(i.cloture_le) - date(i.cree_le)) / 36e5) + ')</span>' : '')) +
      '</div>' +
      '<div class="ps"><div class="pst">Informations déclarées</div><div class="pg">' + champs.join('') + '</div></div>' +
      '<div class="ps"><div class="pst">Ce qui s\'est passé</div><div class="ptx">' + esc(i.description) + '</div></div>' +
      '<div class="ps"><div class="pst">Suivi du traitement</div><div class="tl">' + tl.join('') + '</div></div>';
    icones();
  }

  function rendreFormulaireAction() {
    const i = parId(S.ouvert);
    if (!i) return;
    const agent = memoire.lire(cleAgent()) || '';
    let html;
    if (estBO()) {
      html = '<div class="ps"><div class="pst">Ajouter une action de suivi</div>' +
        '<div class="acts">' + C.ACTIONS_BO.map(function (a) {
          const t = a.statut === 'TERMINE' ? ' t-ok' : a.statut === 'REJETE' ? ' t-ko' : '';
          return '<label class="' + t + '"><input type="radio" name="code" value="' + esc(a.code) + '"><span>' + esc(a.libelle) + '</span></label>';
        }).join('') + '</div>' +
        '<div class="fr"><div class="fcol"><label class="fl" for="aRef">Référence (N° CA, N° de demande…)</label><input class="in" id="aRef" name="reference" autocomplete="off"></div>' +
        '<div class="fcol"><label class="fl" for="aAgent">Agent Back Office *</label><input class="in" id="aAgent" name="agent" value="' + esc(agent) + '"></div></div>' +
        '<label class="fl" for="aCom">Commentaire</label><textarea class="in" id="aCom" name="commentaire" rows="3" placeholder="Détail de l\'action, réponse de l\'opérateur, consigne au PDV…"></textarea>';
    } else {
      html = '<div class="ps"><div class="pst">Ajouter un complément d\'information</div>' +
        '<input type="hidden" name="code" value="COMPLEMENT">' +
        '<label class="fl" for="aCom">Message au Back Office *</label><textarea class="in" id="aCom" name="commentaire" rows="3" placeholder="Réponse à une demande du Back Office, nouvelle information…"></textarea>';
    }
    html += '<div class="lg-err" id="aErr"></div><div class="pf-ft"><button class="btn bp" type="submit">' + ico('check') + 'Enregistrer</button></div></div>';
    $('#pForm').innerHTML = '<form id="fAct" novalidate>' + html + '</form>';
    $('#fAct').addEventListener('submit', soumettreAction);
    icones();
  }

  async function soumettreAction(e) {
    e.preventDefault();
    const f = e.target;
    const code = (f.querySelector('[name=code]:checked') || f.querySelector('input[type=hidden][name=code]') || {}).value;
    const data = {
      incident_id: S.ouvert,
      code: code,
      reference: f.reference ? f.reference.value.trim() : '',
      commentaire: f.commentaire.value.trim(),
      // Le point de vente agit en son nom ; seul le Back Office indique l'agent.
      agent: f.agent ? f.agent.value.trim() : S.session.profil,
    };
    const err = $('#aErr');
    err.textContent = '';
    if (!code) { err.textContent = 'Choisissez une action.'; return; }
    if (!data.agent) { err.textContent = "Indiquez le nom de l'agent."; f.agent.focus(); return; }
    if (!estBO() && !data.commentaire) { err.textContent = 'Écrivez votre message au Back Office.'; f.commentaire.focus(); return; }
    const bouton = f.querySelector('[type=submit]');
    bouton.disabled = true;
    try {
      const r = await Store.addAction(S.session, data);
      if (estBO()) memoire.ecrire(cleAgent(), data.agent);
      const k = S.incidents.findIndex(function (x) { return x.id === r.incident.id; });
      if (k >= 0) S.incidents[k] = r.incident;
      S.actions.push(r.action);
      rendre();
      rendrePanneau();
      rendreFormulaireAction();
      toast('Action enregistrée : ' + r.action.libelle, 'ok');
    } catch (ex) {
      err.textContent = ex.message;
      bouton.disabled = false;
    }
  }

  /* ================= Déclaration (PDV) : assistant pas à pas ================= */

  const ETAPES = [null, 'Type de paiement', "Détails de l'opération", "Ce qui s'est passé", 'Vérification et envoi'];
  let etape = 1;

  function initDeclaration() {
    $('#nOps').innerHTML = C.OPERATEURS.map(function (o) {
      return '<label style="--opc:' + esc(o.couleur) + '"><input type="radio" name="operateur" value="' + esc(o.code) + '"><span><span class="op-d" style="background:' + esc(o.couleur) + '"></span>' + esc(o.nom) + '</span></label>';
    }).join('') + '<label class="only-f"><input type="radio" name="operateur" value=""><span>Espèces / autre</span></label>';
    $('#nIncident').innerHTML = '<option value="">— Choisir —</option>' + C.INCIDENTS_FORMALITE.map(function (x) { return '<option>' + esc(x) + '</option>'; }).join('');

    // Choisir le type de paiement fait passer directement à l'étape suivante.
    $$('#fNew [name=nature]').forEach(function (r) {
      r.addEventListener('change', function () { appliquerNature(r.value); allerA(2); });
    });
    $$('#mNew [data-close]').forEach(function (b) { b.addEventListener('click', fermerDeclaration); });
    $('#mNew').addEventListener('click', function (e) { if (e.target.id === 'mNew') fermerDeclaration(); });
    $('#nPrev').addEventListener('click', function () { if (etape === 1) fermerDeclaration(); else allerA(etape - 1); });
    $('#nNext').addEventListener('click', suivant);
    $('#nSteps').addEventListener('click', function (e) {
      const li = e.target.closest('li[data-step]');
      if (li && Number(li.dataset.step) < etape) allerA(Number(li.dataset.step));
    });
    $('#fNew').addEventListener('submit', soumettreDeclaration);
    $('#fNew').addEventListener('input', function (e) { if (e.target.classList) e.target.classList.remove('err'); });
  }

  function natureChoisie() {
    return ($('#fNew [name=nature]:checked') || {}).value || '';
  }

  function donneesDeclaration() {
    const f = $('#fNew');
    const n = natureChoisie();
    const formalite = n === 'FORMALITE';
    return {
      categorie: formalite ? 'FORMALITE' : 'MOBILE_MONEY',
      type_operation: formalite ? '' : n,
      operateur: (f.querySelector('[name=operateur]:checked') || {}).value || '',
      date_operation: f.date_operation.value,
      montant: f.montant.value,
      telephone: formalite ? '' : f.telephone.value.trim(),
      reference: formalite ? '' : f.reference.value.trim(),
      incident: formalite ? f.incident.value : '',
      num_liquidation: formalite ? f.num_liquidation.value.trim() : '',
      formalite: formalite ? f.formalite.value.trim() : '',
      description: f.description.value.trim(),
      solution: f.solution.value,
      // Pas de nom d'agent à saisir : la déclaration est faite au nom du point de vente.
      declarant: S.session.profil,
    };
  }

  // Champs obligatoires d'une étape ; renvoie ce qui manque et met les champs en évidence.
  function controlerEtape(k) {
    const f = $('#fNew');
    const d = donneesDeclaration();
    const manquants = [];
    const exiger = function (ok, el, libelle) { if (!ok) { manquants.push(libelle); if (el) el.classList.add('err'); } };
    if (k === 1) exiger(natureChoisie(), null, 'le type de paiement');
    if (k === 2) {
      if (d.categorie === 'FORMALITE') {
        exiger(d.incident, f.incident, "l'incident survenu");
        exiger(d.num_liquidation, f.num_liquidation, 'le n° de liquidation');
        exiger(d.formalite, f.formalite, 'la formalité voulue');
      } else {
        exiger(d.operateur, null, "l'opérateur");
      }
      exiger(Number(d.montant) > 0, f.montant, 'le montant');
      exiger(d.date_operation, f.date_operation, "la date de l'opération");
    }
    if (k === 3) {
      exiger(d.description, f.description, "ce qui s'est passé");
      exiger(d.solution, f.solution, 'la solution demandée');
    }
    return manquants;
  }

  function signalerManquants(manquants) {
    $('#nErr').textContent = 'À compléter : ' + manquants.join(', ') + '.';
    const premier = $('#fNew .err');
    if (premier) premier.focus();
  }

  function suivant() {
    const manquants = controlerEtape(etape);
    if (manquants.length) { signalerManquants(manquants); return; }
    allerA(etape + 1);
  }

  function allerA(k) {
    etape = k;
    $('#nErr').textContent = '';
    $$('#fNew .nstep').forEach(function (s) { s.hidden = Number(s.dataset.step) !== k; });
    $$('#nSteps li').forEach(function (li) {
      const n = Number(li.dataset.step);
      li.className = n < k ? 'fait' : n === k ? 'actif' : '';
    });
    $('#mNewTitle').textContent = ETAPES[k];
    $('#nPrev').innerHTML = k === 1 ? ico('x') + 'Annuler' : ico('arrow-left') + 'Précédent';
    $('#nNext').hidden = k === 4;
    $('#nSubmit').hidden = k !== 4;
    if (k === 4) rendreRecap();
    icones();
    $('#mNew').scrollTop = 0;
    const champ = $('#fNew .nstep[data-step="' + k + '"]').querySelector('input:not([type=radio]), select, textarea');
    if (champ && window.innerWidth > 700) champ.focus();
  }

  function rendreRecap() {
    const d = donneesDeclaration();
    const it = function (l, v, large) {
      return '<div class="pi' + (large ? ' w' : '') + '"><div class="pil">' + l + '</div><div class="piv">' + (v || '<span class="z">—</span>') + '</div></div>';
    };
    const n = NATURES[natureChoisie()];
    const champs = [it('Type de paiement', n ? ico(n.ico) + ' ' + n.libelle : '')];
    if (d.categorie === 'FORMALITE') {
      champs.push(it('Incident survenu', esc(d.incident)), it('N° de liquidation', esc(d.num_liquidation)),
        it('Formalité voulue', esc(d.formalite)), it('Moyen de paiement', d.operateur ? pastilleOp(d.operateur) : ''));
    } else {
      champs.push(it('Opérateur', pastilleOp(d.operateur)), it('N° client', esc(d.telephone)), it('Référence transaction', esc(d.reference)));
    }
    champs.push(it('Montant', fcfa(d.montant)), it("Date de l'opération", fDateHeure(d.date_operation)),
      it("Ce qui s'est passé", esc(d.description), true), it('Solution demandée', esc(d.solution), true));
    $('#nRecap').innerHTML = champs.join('');
  }

  function appliquerNature(n) {
    const formalite = n === 'FORMALITE';
    $('#mNew').classList.toggle('n-mm', !formalite);
    $('#mNew').classList.toggle('n-f', formalite);
    const solutions = formalite ? C.SOLUTIONS_FORMALITE : C.SOLUTIONS_MOBILE_MONEY;
    const avant = $('#nSolution').value;
    $('#nSolution').innerHTML = '<option value="">— Choisir —</option>' + solutions.map(function (x) { return '<option>' + esc(x) + '</option>'; }).join('');
    if (solutions.indexOf(avant) >= 0) $('#nSolution').value = avant;
    const espece = $('#nOps input[value=""]');
    if (!formalite && espece.checked) espece.checked = false;
  }

  function maintenantLocal() {
    const d = new Date();
    return cleJour(d) + 'T' + p2(d.getHours()) + ':' + p2(d.getMinutes());
  }

  function ouvrirDeclaration() {
    const f = $('#fNew');
    f.reset();
    $$('.err', f).forEach(function (x) { x.classList.remove('err'); });
    $('#mNew').classList.remove('n-mm', 'n-f');
    $('#mNewPdv').textContent = 'Nouvelle déclaration · ' + S.session.profil;
    $('#nDate').value = maintenantLocal();
    $('#nDate').max = maintenantLocal();
    const formalites = {};
    C.FORMALITES.concat(S.incidents.map(function (i) { return i.formalite; })).forEach(function (x) { if (x) formalites[x] = true; });
    $('#dlFormalites').innerHTML = Object.keys(formalites).sort().map(function (x) { return '<option value="' + esc(x) + '">'; }).join('');
    $('#nSubmit').disabled = false;
    $('#mNew').hidden = false;
    document.body.style.overflow = 'hidden';
    allerA(1);
  }

  function fermerDeclaration() {
    $('#mNew').hidden = true;
    document.body.style.overflow = '';
  }

  async function soumettreDeclaration(e) {
    e.preventDefault();
    // Entrée dans un champ : on avance d'une étape au lieu d'envoyer.
    if (etape < 4) { suivant(); return; }
    for (let k = 1; k < 4; k++) {
      const manquants = controlerEtape(k);
      if (manquants.length) { allerA(k); controlerEtape(k); signalerManquants(manquants); return; }
    }

    $('#nSubmit').disabled = true;
    try {
      const inc = await Store.create(S.session, donneesDeclaration());
      fermerDeclaration();
      S.incidents.push(inc);
      rendre();
      toast('Incident ' + inc.id + ' déclaré. Le Back Office va le prendre en charge.', 'ok');
      ouvrirPanneau(inc.id);
    } catch (ex) {
      $('#nErr').textContent = ex.message;
      $('#nSubmit').disabled = false;
    }
  }

  /* ================= Export Excel ================= */

  function exporterExcel() {
    if (!window.XLSX) { toast("La bibliothèque Excel n'a pas pu être chargée (connexion internet ?).", 'err'); return; }
    const lignes = S.lignesTable;
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
        'Opérateur': opNom(i.operateur), "Date de l'opération": fDateHeure(i.date_operation), 'Montant (FCFA)': Number(i.montant) || 0,
        'N° client': i.telephone, 'Référence transaction': i.reference, 'Incident (formalité)': i.incident,
        'N° liquidation': i.num_liquidation, 'Formalité voulue': i.formalite, 'Ce qui s\'est passé': i.description,
        'Solution demandée': i.solution, 'Statut': (STATUTS[i.statut] || {}).libelle, 'Dernière action': i.derniere_action,
        'Déclarant': i.declarant, 'Déclaré le': fDateHeure(i.cree_le), 'Mis à jour le': fDateHeure(i.maj_le),
        'Clôturé le': i.cloture_le ? fDateHeure(i.cloture_le) : '',
      };
    }), [16, 18, 11, 14, 17, 15, 14, 18, 24, 16, 20, 50, 30, 10, 26, 18, 17, 17, 17]), 'Incidents');

    XLSX.utils.book_append_sheet(wb, feuille(S.actions.filter(function (a) { return ids[a.incident_id]; })
      .sort(function (a, b) { return String(a.cree_le).localeCompare(String(b.cree_le)); })
      .map(function (a) {
        return {
          'N° incident': a.incident_id, 'Date': fDateHeure(a.cree_le), 'Auteur': a.auteur, 'Agent': a.agent,
          'Action': a.libelle, 'Référence': a.reference, 'Commentaire': a.commentaire,
          'Statut après': (STATUTS[a.statut_apres] || {}).libelle || '',
        };
      }), [16, 17, 16, 18, 28, 16, 60, 12]), 'Actions de suivi');

    if (estBO()) {
      XLSX.utils.book_append_sheet(wb, feuille(C.POINTS_DE_VENTE.map(function (p) {
        const st = stats(lignes.filter(function (i) { return i.pdv === p; }));
        return {
          'Point de vente': p, 'Déclarés': st.n, 'Montant (FCFA)': st.montant, 'Nouveaux': st.NOUVEAU,
          'En cours': st.EN_COURS, 'Terminés': st.TERMINE, 'Rejetés': st.REJETE, 'Taux de traitement (%)': st.taux,
        };
      }), [20, 10, 16, 10, 10, 10, 10, 20]), 'Synthèse PDV');
    }
    const nom = 'incidents_' + S.session.profil.toLowerCase().replace(/[^a-z0-9]+/g, '-') + '_' + cleJour(new Date()) + '.xlsx';
    XLSX.writeFile(wb, nom);
    toast('Export Excel : ' + lignes.length + ' incident(s)', 'ok');
  }

  /* ================= Démarrage ================= */

  initConnexion();
  const enregistree = memoire.lire(CLE_SESSION);
  if (Store.configure && enregistree && enregistree.profil) {
    profilChoisi = enregistree.profil;
    connecter(enregistree.profil, enregistree.code || '', true);
  } else {
    afficherConnexion();
  }
})();
