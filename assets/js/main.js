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

// Botão flutuante do WhatsApp: sai com fade enquanto a seção do calendário está na tela.
const waFloat = document.querySelector('.wa-float');
const disponibilidade = document.getElementById('disponibilidade');
if (waFloat && disponibilidade && 'IntersectionObserver' in window) {
  new IntersectionObserver(([entrada]) => {
    waFloat.classList.toggle('is-hidden', entrada.isIntersecting);
  }, { threshold: 0.15 }).observe(disponibilidade);
}
