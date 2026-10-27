/*
 * Accès aux données : API Google Apps Script (apps-script/Code.gs).
 * La feuille Google Sheets sert de base partagée entre les points de vente et le Back Office.
 * Interface : login, list, create, addAction, et pour le Back Office otpEnvoyer, otpVerifier, logout.
 *
 * Mode démonstration : ajouter ?demo à l'URL pour tester l'interface avec des données fictives
 * (rien n'est envoyé au serveur, tout est perdu au rechargement).
 */
(function () {
  'use strict';
  const C = window.APP_CONFIG;
  const DEMO = /[?&]demo\b/.test(location.search);

  try { localStorage.removeItem('sip_demo_v1'); } catch (e) { /* stockage indisponible */ }

  function erreur(code, message) {
    const e = new Error(message);
    e.code = code;
    return e;
  }

  async function appel(payload) {
    if (!C.API_URL) {
      throw erreur('NON_CONFIGURE', "L'application n'est pas encore reliée à sa base de données (API_URL vide dans assets/js/config.js).");
    }
    let res;
    try {
      // text/plain évite la requête préalable CORS que Apps Script ne gère pas.
      res = await fetch(C.API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(payload),
      });
    } catch (e) {
      throw erreur('RESEAU', 'Impossible de joindre le serveur. Vérifiez votre connexion internet.');
    }
    if (!res.ok) throw erreur('RESEAU', 'Le serveur a répondu ' + res.status + '.');
    let data;
    try {
      data = await res.json();
    } catch (e) {
      throw erreur('REPONSE', 'Réponse inattendue du serveur (vérifiez le déploiement Apps Script).');
    }
    if (!data.ok) throw erreur(data.code || 'ERREUR', data.message || 'Erreur inconnue.');
    return data;
  }

  /* ---------------- Démonstration (données fictives en mémoire) ---------------- */

  function demo() {
    const BO = C.BACK_OFFICE;
    const iso = function (d) { return new Date(d).toISOString(); };
    const pause = function (v) { return new Promise(function (r) { setTimeout(function () { r(v); }, 250 + Math.random() * 250); }); };
    let graine = 7;
    const hasard = function () { graine = (graine * 16807) % 2147483647; return (graine - 1) / 2147483646; };
    const pick = function (t) { return t[Math.floor(hasard() * t.length)]; };
    const incidents = [];
    const actions = [];
    let seq = 0;
    const nouvelId = function (d) { seq += 1; return 'INC-' + String(d.getFullYear()).slice(2) + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(seq).padStart(4, '0'); };
    const libelle = function (code) {
      if (code === 'COMPLEMENT') return "Complément d'information du PDV";
      const a = C.ACTIONS_BO.find(function (x) { return x.code === code; });
      return a ? a.libelle : code;
    };

    function ajouterAction(inc, code, auteur, agent, quand, commentaire, reference) {
      const def = C.ACTIONS_BO.find(function (x) { return x.code === code; });
      if (def && def.statut) inc.statut = def.statut;
      const a = {
        id: 'ACT-' + (actions.length + 1), incident_id: inc.id, code: code, libelle: libelle(code),
        auteur: auteur, agent: agent, commentaire: commentaire || '', reference: reference || '',
        statut_apres: inc.statut, cree_le: iso(quand),
      };
      actions.push(a);
      inc.derniere_action = a.libelle;
      inc.maj_le = a.cree_le;
      if (inc.statut === 'TERMINE' || inc.statut === 'REJETE') inc.cloture_le = a.cree_le;
      return a;
    }

    const descs = {
      DEPOT: ['Le client a fait un dépôt, notre compte a été débité mais il n\'a rien reçu.', 'Dépôt effectué sur un mauvais numéro, le client demande l\'annulation.', 'Transaction restée en attente côté opérateur.'],
      RETRAIT: ['Retrait validé par le client mais notre compte n\'a pas été crédité.', 'Le client a été débité deux fois pour un seul retrait.'],
      FORMALITE: ['L\'usager a payé mais le paiement est resté en attente.', 'Le montant débité ne correspond pas au montant de la formalité.'],
    };
    const agents = ['K. Yao', 'A. Traoré', 'M. Koné'];
    const now = Date.now();
    for (let k = 0; k < 74; k++) {
      const ageH = Math.pow(hasard(), 1.6) * 24 * 75;
      const cree = new Date(now - ageH * 36e5);
      const nat = pick(['DEPOT', 'DEPOT', 'RETRAIT', 'RETRAIT', 'FORMALITE']);
      const f = nat === 'FORMALITE';
      const pdv = pick(C.POINTS_DE_VENTE.slice(0, 18));
      const inc = {
        id: nouvelId(cree), pdv: pdv, declarant: pdv, categorie: f ? 'FORMALITE' : 'MOBILE_MONEY', type_operation: f ? '' : nat,
        operateur: pick(C.OPERATEURS).code,
        date_operation: iso(cree.getTime() - hasard() * 6 * 36e5),
        montant: pick([5000, 10000, 15000, 25000, 50000, 75000, 100000, 150000, 250000, 600000, 1200000]),
        telephone: f ? '' : '07' + String(Math.floor(hasard() * 1e8)).padStart(8, '0'),
        reference: f ? '' : 'TX' + Math.floor(hasard() * 1e10),
        incident: f ? pick(C.INCIDENTS_FORMALITE) : '',
        num_liquidation: f ? 'LIQ-' + Math.floor(1e6 + hasard() * 9e6) : '',
        formalite: f ? pick(['Carte grise', 'Mutation', 'Duplicata', 'Visite technique']) : '',
        description: pick(descs[nat]),
        solution: 'À définir par le Back Office',
        statut: 'NOUVEAU', derniere_action: 'Déclaration', cree_le: iso(cree), maj_le: iso(cree), cloture_le: '',
      };
      incidents.push(inc);
      const agent = pick(agents);
      const r = hasard();
      if (ageH < 10 && r < .7) continue;
      if (r < .12) continue; // reste « Nouveau »
      const t = function (h) { return Math.min(now - 60e3, cree.getTime() + h * 36e5); };
      ajouterAction(inc, 'PRISE_EN_CHARGE', BO, agent, t(1 + hasard() * 8));
      if (r < .3) continue;
      const suite = pick(['CREATION_CA', 'RELANCE', 'DEMANDE_REGULARISATION']);
      const ref = suite === 'DEMANDE_REGULARISATION' ? 'Régularisation ' + inc.id + ' – ' + pdv : suite === 'CREATION_CA' ? 'CA-' + Math.floor(hasard() * 1e5) : '';
      const act = ajouterAction(inc, suite, BO, agent, t(10 + hasard() * 10), 'Dossier transmis à l\'opérateur.', ref);
      if (suite === 'DEMANDE_REGULARISATION') act.date_envoi = act.cree_le.slice(0, 10);
      if (r < .5) {
        ajouterAction(inc, 'RELANCE', BO, agent, t(22), 'Relance envoyée à l\'opérateur.');
        continue;
      }
      if (ageH < 30) continue;
      if (r < .9) ajouterAction(inc, 'TERMINE', BO, agent, t(24 + hasard() * 48), 'Régularisation effectuée par l\'opérateur.');
      else ajouterAction(inc, 'TERMINE', BO, agent, t(24 + hasard() * 24), 'La transaction avait bien abouti côté opérateur.');
    }

    // Codes de connexion du Back Office : affichés à l'écran au lieu d'être envoyés par e-mail.
    const otps = {};
    const agentBo = function (email) {
      const u = (C.BO_UTILISATEURS || []).find(function (x) { return x.email === email; });
      if (!u) throw erreur('AGENT_INCONNU', "Cet agent n'est pas autorisé au Back Office.");
      return u;
    };

    function verifier(s) {
      if (s.profil !== BO && C.POINTS_DE_VENTE.indexOf(s.profil) < 0) throw erreur('PROFIL_INCONNU', 'Profil inconnu.');
      if (s.profil !== BO) return { ok: true, profil: s.profil, user: null };
      // Jeton de démonstration : « demo: » suivi de l'e-mail de l'agent.
      const u = (C.BO_UTILISATEURS || []).find(function (x) { return 'demo:' + x.email === s.token; });
      if (!u) throw erreur('SESSION_EXPIREE', 'Session Back Office expirée, reconnectez-vous.');
      return { ok: true, profil: s.profil, user: { nom: u.nom, poste: u.poste, email: u.email } };
    }
    const cleJourDemo = function (d) { return d.toISOString().slice(0, 10); };
    const copie = function (o) { return JSON.parse(JSON.stringify(o)); };

    return {
      configure: true,
      demo: true,
      login: function (s) { try { return pause(verifier(s)); } catch (e) { return Promise.reject(e); } },
      verifierLiquidation: function (s, num) {
        verifier(s);
        const cle = function (v) { return String(v || '').toLowerCase().replace(/[^a-z0-9]/g, ''); };
        const deja = num && incidents.find(function (i) { return i.num_liquidation && cle(i.num_liquidation) === cle(num); });
        return pause(deja ? { ok: true, existe: true, id: deja.id, pdv: deja.pdv } : { ok: true, existe: false });
      },
      otpEnvoyer: function (email) {
        const u = agentBo(email);
        const code = String(Math.floor(1e5 + Math.random() * 9e5));
        otps[email] = { code: code, exp: Date.now() + (C.OTP_MINUTES || 5) * 6e4 };
        return pause({ ok: true, email: u.email, expire: (C.OTP_MINUTES || 5) * 60, demoCode: code });
      },
      otpVerifier: function (email, otp) {
        const u = agentBo(email);
        const o = otps[email];
        if (!o || o.exp < Date.now()) return Promise.reject(erreur('OTP_EXPIRE', 'Code expiré ou inexistant. Demandez un nouveau code.'));
        if (o.code !== otp) return Promise.reject(erreur('OTP_INVALIDE', 'Code incorrect.'));
        delete otps[email];
        return pause({ ok: true, token: 'demo:' + u.email, profil: BO, isBO: true, user: { nom: u.nom, poste: u.poste, email: u.email } });
      },
      logout: function () { return Promise.resolve({ ok: true }); },
      list: function (s) {
        verifier(s);
        const mes = s.profil === BO ? incidents : incidents.filter(function (i) { return i.pdv === s.profil; });
        const ids = {};
        mes.forEach(function (i) { ids[i.id] = true; });
        return pause({ ok: true, incidents: copie(mes), actions: copie(actions.filter(function (a) { return ids[a.incident_id]; })) });
      },
      create: function (s, data) {
        verifier(s);
        const cle = function (v) { return String(v || '').toLowerCase().replace(/[^a-z0-9]/g, ''); };
        const deja = data.num_liquidation && incidents.find(function (i) { return i.num_liquidation && cle(i.num_liquidation) === cle(data.num_liquidation); });
        if (deja) return Promise.reject(erreur('DOUBLON_LIQUIDATION', 'Le n° de liquidation ' + data.num_liquidation + ' a déjà été déclaré (' + deja.id + ', ' + deja.pdv + ').'));
        const d = new Date();
        const inc = Object.assign({}, data, {
          id: nouvelId(d), pdv: s.profil, statut: 'NOUVEAU', derniere_action: 'Déclaration',
          cree_le: iso(d), maj_le: iso(d), cloture_le: '',
        });
        inc.date_operation = inc.date_operation || cleJourDemo(d);
        incidents.push(inc);
        return pause(copie(inc));
      },
      addAction: function (s, data) {
        verifier(s);
        const inc = incidents.find(function (i) { return i.id === data.incident_id; });
        if (!inc) return Promise.reject(erreur('INTROUVABLE', 'Incident introuvable.'));
        const a = ajouterAction(inc, data.code, s.profil, data.agent, Date.now(), data.commentaire, data.reference);
        a.date_envoi = data.date_envoi || '';
        return pause({ ok: true, incident: copie(inc), action: copie(a) });
      },
    };
  }

  window.Store = DEMO ? demo() : {
    configure: !!C.API_URL,
    demo: false,
    login: function (s) { return appel({ action: 'login', profil: s.profil, code: s.code, token: s.token }); },
    verifierLiquidation: function (s, num) { return appel({ action: 'checkLiquidation', profil: s.profil, code: s.code, token: s.token, num: num }); },
    otpEnvoyer: function (email) { return appel({ action: 'otpSend', email: email }); },
    otpVerifier: function (email, otp) { return appel({ action: 'otpVerify', email: email, otp: otp }); },
    logout: function (s) { return appel({ action: 'logout', token: s.token }).catch(function () { /* déjà expirée */ }); },
    list: function (s) { return appel({ action: 'list', profil: s.profil, code: s.code, token: s.token }); },
    create: function (s, data) {
      return appel({ action: 'create', profil: s.profil, code: s.code, token: s.token, data: data }).then(function (r) { return r.incident; });
    },
    addAction: function (s, data) { return appel({ action: 'addAction', profil: s.profil, code: s.code, token: s.token, data: data }); },
  };
})();
