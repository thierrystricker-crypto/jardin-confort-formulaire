/* jc-borne.js — panier borne magasin → liste d'achat de l'app (01.10.2026)
 * Marquer un poste comme borne : ouvrir une fois https://jardin-confort.ch/?borne=on
 * Le démarquer : https://jardin-confort.ch/?borne=off
 * Sans marque, ce script ne fait rien de visible.
 */
(function () {
  if (window.__jcBorne) return;
  window.__jcBorne = true;

  var CLE = 'jc-borne';
  var API = 'https://offres.jardin-confort.ch/api/listes-achat/borne';

  try {
    var p = new URLSearchParams(location.search).get('borne');
    if (p === 'on') localStorage.setItem(CLE, '1');
    if (p === 'off') localStorage.removeItem(CLE);
  } catch (e) {}

  var estBorne = false;
  try { estBorne = localStorage.getItem(CLE) === '1'; } catch (e) {}
  if (!estBorne) return;
  document.documentElement.classList.add('jc-borne');

  function fenetre(html) {
    var o = document.createElement('div');
    o.className = 'jc-borne-overlay';
    o.innerHTML = '<div class="jc-borne-carte">' + html + '</div>';
    document.body.appendChild(o);
    return o;
  }

  var enCours = false;
  document.addEventListener('click', function (ev) {
    var btn = ev.target.closest && ev.target.closest('.js-jc-borne-btn');
    if (!btn || enCours) return;
    ev.preventDefault();
    enCours = true;
    var attente = fenetre('<p class="h5">Transmission en cours…</p>');

    fetch('/cart.js', { credentials: 'same-origin' })
      .then(function (r) { return r.json(); })
      .then(function (cart) {
        var items = (cart.items || []).map(function (it) {
          return { variant_id: it.variant_id, qty: it.quantity };
        });
        if (!items.length) throw new Error('Votre panier est vide.');
        // text/plain = requête « simple », sans preflight CORS
        return fetch(API, {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain' },
          body: JSON.stringify({ items: items })
        });
      })
      .then(function (r) {
        return r.json().then(function (j) {
          if (!r.ok || !j.code) throw new Error(j.error || 'Transmission impossible.');
          return j;
        });
      })
      .then(function (j) {
        attente.remove();
        // Le panier est sauvé côté app : on le vide pour le client suivant.
        fetch('/cart/clear.js', { method: 'POST', credentials: 'same-origin' }).catch(function () {});
        var o = fenetre(
          '<p class="h5 mb-0">Montrez ce code à un conseiller</p>' +
          '<div class="jc-borne-code">' + j.code + '</div>' +
          '<p>Votre sélection (' + j.nb + ' article' + (j.nb > 1 ? 's' : '') + ') lui a été transmise.</p>' +
          '<button type="button" class="btn btn--primary mt-6 js-jc-borne-fin">Terminé</button>'
        );
        o.querySelector('.js-jc-borne-fin').addEventListener('click', function () {
          location.href = '/';
        });
      })
      .catch(function (e) {
        attente.remove();
        var o = fenetre(
          '<p class="h5">Oups</p><p>' + String(e && e.message ? e.message : 'Transmission impossible.').replace(/[<>&"]/g, '') +
          '</p><p>Un conseiller peut vous aider.</p>' +
          '<button type="button" class="btn btn--primary mt-6">Fermer</button>'
        );
        o.querySelector('button').addEventListener('click', function () { o.remove(); });
      })
      .then(function () { enCours = false; });
  });
})();
