/* ============================================================
   MECHANIC: GAME OVER? (Camp) — softlock escape
   Shows, pulsing red at the top of Camp, while gold is 0, wood + stone
   is 200 or less and Gold Panning is not yet revealed (its gold needs no
   gold). Reset: two presses (the second within 5s), then Save's own
   eraseAndReload. Dismiss: hidden until reload. Nothing is saved.
   ============================================================ */
(function () {
  'use strict';
  const OW = window.OrbWeaver, R = OW.Resources;
  let dismissed = false, armed = false, timer = 0;
  const stuck = () => !dismissed && R.get('gold') <= 0 && R.get('wood') + R.get('stone') <= 200 && !OW.Mechanics.get('goldpanning').revealed;
  const btn = () => document.querySelector('#card-modal-body [data-go="reset"]');

  const card = {
    id: 'gameover', section: 'Camp', startHidden: true, noPin: true,
    stepperReady: () => false, hideUpgradeBar: () => true, getUpgradeBarPct: () => 0,
    cardName: () => 'GAME OVER? Click Me',
    getStatText: () => 'Out of gold', getSubtitleHtml: () => 'Out of gold',
    renderModalHTML: () => `<div class="sp-req-msg">You've run out of gold. Workers stop working without it, and you don't have enough wood or stone left to sell for more. Keep an eye on your gold spending: every worker costs gold to keep.</div>
      <div class="go-btns"><button class="action-btn danger" data-go="reset">Reset game</button><button class="action-btn" data-go="dismiss">Dismiss</button></div>`,
    afterRender() {
      armed = false;
      document.querySelector('#card-modal-body .go-btns').addEventListener('click', (e) => {
        const act = e.target.dataset.go;
        if (act === 'dismiss') { dismissed = true; OW.Cards.closeModal(); OW.Footer.push('You can reset the game anytime in the Settings menu.'); }
        else if (act === 'reset' && armed) OW.Save.eraseAndReload();
        else if (act === 'reset') {
          armed = true; e.target.textContent = 'Really reset? This erases your save.';
          clearTimeout(timer); timer = setTimeout(() => { armed = false; if (btn()) btn().textContent = 'Reset game'; }, 5000);
        }
      });
    },
    tick() {
      if (!card.els) return;
      const on = stuck();
      if (on !== !!card.revealed) on ? OW.Cards.reveal(card) : OW.Cards.hide(card);
    }
  };

  OW.Mechanics.register(card);
  // After main.js has built every card (window hears DOMContentLoaded after document does).
  window.addEventListener('DOMContentLoaded', () => {
    const el = OW.Cards.build(card);
    el.classList.add('mo-pulse', 'go-card');
    document.getElementById('grid-camp').prepend(el);
  });
})();
