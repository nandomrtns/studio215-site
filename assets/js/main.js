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
