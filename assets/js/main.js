const header = document.getElementById('siteHeader');
window.addEventListener('scroll', () => {
  header.classList.toggle('scrolled', window.scrollY > 40);
});

// Menu mobile
const burger = document.getElementById('headerBurger');
const mobileMenu = document.getElementById('mobileMenu');
if (burger && mobileMenu) {
  burger.addEventListener('click', () => {
    const open = mobileMenu.classList.toggle('open');
    burger.setAttribute('aria-expanded', open ? 'true' : 'false');
  });
  mobileMenu.querySelectorAll('a').forEach(a => {
    a.addEventListener('click', () => {
      mobileMenu.classList.remove('open');
      burger.setAttribute('aria-expanded', 'false');
    });
  });
}

// Links do menu (#secao): em vez do corte seco, desliza até a seção.
// Curva ease-in-out com duração proporcional à distância (600–1200 ms), e
// qualquer gesto do usuário (roda, toque, tecla) interrompe na hora.
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
let scrollAnim = null;
const cancelScrollAnim = () => { if (scrollAnim) { cancelAnimationFrame(scrollAnim); scrollAnim = null; } };
['wheel', 'touchstart', 'keydown'].forEach((ev) =>
  window.addEventListener(ev, cancelScrollAnim, { passive: true }));

function smoothScrollTo(targetY) {
  cancelScrollAnim();
  const startY = window.scrollY;
  const maxY = document.documentElement.scrollHeight - window.innerHeight;
  const endY = Math.max(0, Math.min(targetY, maxY));
  const dist = endY - startY;
  if (reduceMotion.matches || Math.abs(dist) < 2) { window.scrollTo(0, endY); return; }
  const duration = Math.min(1200, Math.max(600, Math.abs(dist) * 0.35));
  const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
  const t0 = performance.now();
  const step = (now) => {
    const t = Math.min(1, (now - t0) / duration);
    window.scrollTo(0, startY + dist * ease(t));
    scrollAnim = t < 1 ? requestAnimationFrame(step) : null;
  };
  scrollAnim = requestAnimationFrame(step);
}

document.querySelectorAll('a[href^="#"]').forEach((a) => {
  const id = a.getAttribute('href').slice(1);
  a.addEventListener('click', (e) => {
    const target = id ? document.getElementById(id) : null;
    if (id && !target) return;
    e.preventDefault();
    smoothScrollTo(target ? target.getBoundingClientRect().top + window.scrollY : 0);
    history.pushState(null, '', id ? '#' + id : location.pathname);
  });
});

// Carrossel da hero — Ken Burns + crossfade, 2s por foto
const heroImgs = document.querySelectorAll('.hero-bg-img');
if (heroImgs.length) {
  let heroIdx = 0;
  const showHeroSlide = () => {
    heroImgs.forEach((img, i) => img.classList.toggle('active', i === heroIdx));
    heroIdx = (heroIdx + 1) % heroImgs.length;
  };
  showHeroSlide();
  setInterval(showHeroSlide, 4000);
}

const lightbox = document.getElementById('lightbox');
const lightboxImg = document.getElementById('lightboxImg');
const lightboxClose = document.getElementById('lightboxClose');

document.querySelectorAll('.lb-trigger').forEach(a => {
  a.addEventListener('click', (e) => {
    e.preventDefault();
    lightboxImg.src = a.getAttribute('href');
    lightboxImg.alt = a.querySelector('img').alt;
    lightbox.classList.add('open');
  });
});

function closeLightbox() {
  lightbox.classList.remove('open');
  lightboxImg.src = '';
}

lightboxClose.addEventListener('click', closeLightbox);
lightbox.addEventListener('click', (e) => {
  if (e.target === lightbox) closeLightbox();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeLightbox();
});

// Calendário de disponibilidade e reserva: assets/js/booking.js

// Botão "Copiar e-mail" da seção de contato.
document.querySelectorAll('[data-copy]').forEach((btn) => {
  const original = btn.textContent;
  btn.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(btn.dataset.copy);
      btn.textContent = 'E-mail copiado';
    } catch {
      btn.textContent = btn.dataset.copy;
    }
    setTimeout(() => { btn.textContent = original; }, 2200);
  });
});

// Botão flutuante do WhatsApp: sai com fade enquanto o calendário ou o contato
// (que já têm botão de WhatsApp próprio) estão na tela.
const waFloat = document.querySelector('.wa-float');
const secoesComWhatsapp = ['disponibilidade', 'contato'].map((id) => document.getElementById(id)).filter(Boolean);
if (waFloat && secoesComWhatsapp.length && 'IntersectionObserver' in window) {
  const visiveis = new Set();
  const obs = new IntersectionObserver((entradas) => {
    entradas.forEach((e) => (e.isIntersecting ? visiveis.add(e.target) : visiveis.delete(e.target)));
    waFloat.classList.toggle('is-hidden', visiveis.size > 0);
  }, { threshold: 0.15 });
  secoesComWhatsapp.forEach((el) => obs.observe(el));
}

// Perguntas frequentes: uma aberta por vez, com a altura animada ao abrir e
// fechar. O <details> continua nativo — sem JS funciona igual, só sem movimento.
// A lista reserva a altura da maior resposta aberta, assim a seção de contato
// logo abaixo não sobe e desce a cada clique.
const faqList = document.querySelector('.faq-list');
if (faqList) {
  const faqItems = [...faqList.querySelectorAll('details')];
  const FAQ_EASE = 'cubic-bezier(0.22, 1, 0.36, 1)'; // mesmo --ease-smooth do CSS
  const FAQ_OPEN_MS = 460;
  const FAQ_CLOSE_MS = 340;
  faqList.classList.add('is-enhanced');

  // Mede a altura do item aberto ou fechado (no mesmo frame, sem pintar).
  const alturaCom = (d, aberto) => {
    d.open = aberto;
    return d.getBoundingClientRect().height;
  };

  // Altura da lista toda fechada + a maior resposta (só uma abre por vez).
  const reservarAltura = () => {
    if (faqItems.some((d) => d.classList.contains('is-animating'))) {
      setTimeout(reservarAltura, FAQ_OPEN_MS);
      return;
    }
    const estados = faqItems.map((d) => d.open);
    let fechada = 0;
    let maiorResposta = 0;
    faqItems.forEach((d) => {
      const h = alturaCom(d, false);
      fechada += h;
      maiorResposta = Math.max(maiorResposta, alturaCom(d, true) - h);
    });
    faqItems.forEach((d, i) => { d.open = estados[i]; });
    faqList.style.minHeight = `${Math.ceil(fechada + maiorResposta)}px`;
  };

  // Interrompível: se o clique chega no meio do movimento, parte da altura atual.
  const animarItem = (d, abrir) => {
    const resposta = d.querySelector('p');
    d.classList.toggle('is-open', abrir);
    if (reduceMotion.matches) { d.open = abrir; return; }

    const inicio = d.getBoundingClientRect().height;
    d.getAnimations().forEach((a) => a.cancel());
    resposta.getAnimations().forEach((a) => a.cancel());
    const fim = alturaCom(d, abrir);
    d.open = true; // a resposta precisa existir na tela enquanto fecha
    d.classList.add('is-animating');

    const mov = d.animate(
      [{ height: `${inicio}px` }, { height: `${fim}px` }],
      { duration: abrir ? FAQ_OPEN_MS : FAQ_CLOSE_MS, easing: FAQ_EASE }
    );
    if (abrir) {
      resposta.animate(
        [{ opacity: 0, transform: 'translateY(-6px)' }, { opacity: 1, transform: 'none' }],
        { duration: FAQ_OPEN_MS, delay: 70, easing: FAQ_EASE, fill: 'backwards' }
      );
    } else {
      resposta.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 180, easing: 'ease-out', fill: 'forwards' });
    }
    mov.onfinish = () => {
      d.classList.remove('is-animating');
      if (!abrir) {
        d.open = false;
        resposta.getAnimations().forEach((a) => a.cancel());
      }
    };
  };

  faqItems.forEach((d) => {
    d.classList.toggle('is-open', d.open);
    d.querySelector('summary').addEventListener('click', (e) => {
      e.preventDefault();
      const abrir = !d.classList.contains('is-open');
      if (abrir) faqItems.forEach((outro) => { if (outro !== d && outro.classList.contains('is-open')) animarItem(outro, false); });
      animarItem(d, abrir);
    });
    // O "Localizar" do navegador abre o <details> sozinho: só sincroniza o "+".
    d.addEventListener('toggle', () => {
      if (d.open && !d.classList.contains('is-open') && !d.classList.contains('is-animating')) d.classList.add('is-open');
    });
  });

  document.fonts.ready.then(reservarAltura);
  let faqResize;
  window.addEventListener('resize', () => {
    clearTimeout(faqResize);
    faqResize = setTimeout(reservarAltura, 150);
  });
}
