// Widget de disponibilidade estilo Airbnb: card compacto (check-in/checkout/
// hóspedes) que abre um modal com o calendário navegável ao clicar. O botão
// final de reserva só funciona com ?preview=1 na URL (uso interno) — mesmo
// com o pagamento real ligado (Fase 3), esse gate continua até o Nando
// destravar depois de um primeiro pagamento supervisionado.

const API_BASE = 'https://studio215-booking-production.up.railway.app';
// Chave PÚBLICA do Mercado Pago — seguro expor no cliente, é assim que o
// MP.js funciona. Precisa trocar SEMPRE junto com MP_ACCESS_TOKEN/
// MP_WEBHOOK_SECRET do backend: chave pública de um ambiente com access
// token do outro faz todo pagamento falhar.
const MP_PUBLIC_KEY = 'APP_USR-4092fb94-546e-49a4-bf33-d7db716ee6e9';
const PREVIEW_MODE = new URLSearchParams(window.location.search).has('preview');
const MONTHS_SHOWN = 2;
const MAX_MONTH_OFFSET = 10; // janela navegável de 12 meses (offset + MONTHS_SHOWN)
const AVAILABILITY_WINDOW_DAYS = 380; // cobre a janela de 12 meses inteira numa fetch só
const MAX_GUESTS = 3;
// Igual ao anúncio do Airbnb (mínimo de 1 noite).
const MIN_NIGHTS = 1;
const MONTH_NAMES = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
const WEEKDAYS = ['D','S','T','Q','Q','S','S'];
const RESERVATION_ID_KEY = 'studio215_reservation_id';
const PAYMENT_POLL_INTERVAL_MS = 4000;
// Fora do ?preview=1, a reserva direta fecha no WhatsApp do Nando: o botão
// leva as datas, hóspedes e o total já escritos na mensagem.
const WHATSAPP_NUMBER = '5551991752139';

const bookingWidget = document.getElementById('bookingWidget');
const bookingWidgetTitle = document.getElementById('bookingWidgetTitle');
const bookingWidgetCta = document.getElementById('bookingWidgetCta');
const bookingSummary = document.getElementById('bookingSummary');
const bookingWhatsapp = document.getElementById('bookingWhatsapp');

const fieldCheckIn = document.getElementById('fieldCheckIn');
const fieldCheckOut = document.getElementById('fieldCheckOut');
const checkInValue = document.getElementById('checkInValue');
const checkOutValue = document.getElementById('checkOutValue');

const guestsField = document.getElementById('guestsField');
const guestsValue = document.getElementById('guestsValue');
const guestsPopover = document.getElementById('guestsPopover');
const guestsCountEl = document.getElementById('guestsCount');
const guestsMinus = document.getElementById('guestsMinus');
const guestsPlus = document.getElementById('guestsPlus');

const calModalBackdrop = document.getElementById('calModalBackdrop');
const calModal = document.getElementById('calModal');
const modalFieldCheckIn = document.getElementById('modalFieldCheckIn');
const modalFieldCheckOut = document.getElementById('modalFieldCheckOut');
const modalCheckInValue = document.getElementById('modalCheckInValue');
const modalCheckOutValue = document.getElementById('modalCheckOutValue');
const calPrevBtn = document.getElementById('calPrev');
const calNextBtn = document.getElementById('calNext');
const calGrid = document.getElementById('calGrid');
const calUpdated = document.getElementById('calUpdated');
const calClear = document.getElementById('calClear');
const calClose = document.getElementById('calClose');

const guestForm = document.getElementById('guestForm');
const bookingNote = document.getElementById('bookingNote');
const bookingError = document.getElementById('bookingError');
const bookingConfirmation = document.getElementById('bookingConfirmation');

let blockedDays = new Set();
let minNights = 2;
let selection = { start: null, end: null };
let guestCount = 1;
let lastQuote = null;
let availabilityFailed = false;
let monthOffset = 0;
let paymentPollTimer = null;
let cardBrickController = null;

if (calGrid) {
  initBooking();
  wireStaticEvents();
}

async function initBooking() {
  const restored = await tryRestoreReservation();
  if (restored) return;

  try {
    // A agenda vem do próprio site: uma rotina do GitHub lê o calendário do Airbnb de
    // hora em hora e grava só as datas ocupadas em assets/agenda.json. Sem servidor.
    const res = await fetch('assets/agenda.json', { cache: 'no-cache' });
    if (!res.ok) throw new Error('agenda request failed');
    const data = await res.json();

    minNights = MIN_NIGHTS;
    blockedDays = expandBlockedRanges((data.ocupado || []).map((r) => ({ start: r.inicio, end: r.fim })));
    renderCalendar();

    if (data.atualizado_em && calUpdated) {
      const d = new Date(data.atualizado_em);
      calUpdated.textContent =
        `Atualizado em ${d.toLocaleDateString('pt-BR')} às ${d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`;
    }
  } catch (err) {
    calGrid.innerHTML = '<p class="cal-loading">Não consegui carregar a disponibilidade agora — chame no WhatsApp que a gente confirma na hora.</p>';
    // Sem disponibilidade o calendário não serve pra nada: o card vira direto
    // o botão do WhatsApp em vez de abrir um modal vazio.
    availabilityFailed = true;
    if (!PREVIEW_MODE) {
      if (bookingWidgetCta) bookingWidgetCta.hidden = true;
      showWhatsappCta();
    }
  }
}

async function tryRestoreReservation() {
  const savedId = sessionStorage.getItem(RESERVATION_ID_KEY);
  if (!savedId) return false;

  try {
    const res = await fetch(`${API_BASE}/api/reservations/${savedId}`);
    if (!res.ok) {
      sessionStorage.removeItem(RESERVATION_ID_KEY);
      return false;
    }
    const reservation = await res.json();

    if (reservation.status === 'confirmed') {
      renderConfirmedSuccess(reservation);
      return true;
    }
    if (reservation.status !== 'pending') {
      sessionStorage.removeItem(RESERVATION_ID_KEY);
      return false;
    }

    renderPaymentChoice(reservation);
    // Já tinha um Pix em andamento (ex.: hóspede recarregou a página com o
    // QR aberto) — reabre a tela do QR direto em vez de voltar pra escolha.
    if (reservation.paymentMethod === 'pix' && ['pending', 'in_process'].includes(reservation.mpPaymentStatus)) {
      startPixPayment(reservation);
    }
    return true;
  } catch (err) {
    return false;
  }
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function addDaysIso(iso, days) {
  const d = new Date(`${iso}T00:00:00`);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function expandBlockedRanges(ranges) {
  const set = new Set();
  ranges.forEach((r) => {
    const d = new Date(r.start + 'T00:00:00');
    const end = new Date(r.end + 'T00:00:00');
    while (d < end) {
      set.add(d.toISOString().slice(0, 10));
      d.setDate(d.getDate() + 1);
    }
  });
  return set;
}

function nightsBetween(a, b) {
  const d1 = new Date(a + 'T00:00:00');
  const d2 = new Date(b + 'T00:00:00');
  return Math.round((d2 - d1) / 86_400_000);
}

function hasBlockedDayInRange(start, end) {
  const d = new Date(start + 'T00:00:00');
  const endDate = new Date(end + 'T00:00:00');
  d.setDate(d.getDate() + 1);
  while (d < endDate) {
    if (blockedDays.has(d.toISOString().slice(0, 10))) return true;
    d.setDate(d.getDate() + 1);
  }
  return false;
}

function formatDateBR(iso) {
  const d = new Date(iso + 'T00:00:00');
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' });
}

function formatBRL(cents) {
  return (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

// ---------- Widget compacto (fechado) ----------

function wireStaticEvents() {
  [fieldCheckIn, fieldCheckOut].forEach((el) => {
    if (!el) return;
    el.addEventListener('click', () => openModal(el.dataset.target));
  });
  if (bookingWidgetCta) bookingWidgetCta.addEventListener('click', () => openModal('checkin'));

  if (guestsField) {
    guestsField.addEventListener('click', (e) => {
      e.stopPropagation();
      const isOpen = !guestsPopover.hidden;
      guestsPopover.hidden = isOpen;
      guestsField.setAttribute('aria-expanded', String(!isOpen));
    });
  }
  document.addEventListener('click', (e) => {
    if (guestsPopover && !guestsPopover.hidden && !guestsPopover.contains(e.target) && e.target !== guestsField) {
      guestsPopover.hidden = true;
      guestsField.setAttribute('aria-expanded', 'false');
    }
  });
  if (guestsMinus) guestsMinus.addEventListener('click', () => setGuestCount(guestCount - 1));
  if (guestsPlus) guestsPlus.addEventListener('click', () => setGuestCount(guestCount + 1));

  if (modalFieldCheckIn) {
    modalFieldCheckIn.addEventListener('click', () => {
      selection = { start: null, end: null };
      hideBookingSteps();
      renderCalendar();
      syncFieldDisplays();
    });
  }
  if (modalFieldCheckOut) {
    modalFieldCheckOut.addEventListener('click', () => {
      if (!selection.start) return;
      selection.end = null;
      hideBookingSteps();
      renderCalendar();
      syncFieldDisplays();
    });
  }

  if (calPrevBtn) {
    calPrevBtn.addEventListener('click', () => {
      if (monthOffset === 0) return;
      monthOffset -= 1;
      renderCalendar();
    });
  }
  if (calNextBtn) {
    calNextBtn.addEventListener('click', () => {
      if (monthOffset >= MAX_MONTH_OFFSET) return;
      monthOffset += 1;
      renderCalendar();
    });
  }

  if (calClear) {
    calClear.addEventListener('click', () => {
      selection = { start: null, end: null };
      hideBookingSteps();
      renderCalendar();
      syncFieldDisplays();
    });
  }
  if (calClose) calClose.addEventListener('click', closeModal);
  if (calModalBackdrop) calModalBackdrop.addEventListener('click', closeModal);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && calModal && !calModal.hidden) closeModal();
  });
}

function setGuestCount(next) {
  guestCount = Math.min(MAX_GUESTS, Math.max(1, next));
  guestsCountEl.textContent = String(guestCount);
  guestsValue.textContent = `${guestCount} hóspede${guestCount > 1 ? 's' : ''}`;
  guestsMinus.disabled = guestCount <= 1;
  updateWhatsappLink();
  guestsPlus.disabled = guestCount >= MAX_GUESTS;
}
setGuestCount(1);

function syncFieldDisplays() {
  if (selection.start) {
    checkInValue.textContent = formatDateBR(selection.start);
    checkInValue.classList.remove('placeholder');
    modalCheckInValue.textContent = formatDateBR(selection.start);
  } else {
    checkInValue.textContent = 'Adicionar data';
    checkInValue.classList.add('placeholder');
    modalCheckInValue.textContent = 'DD/MM/AAAA';
  }

  if (selection.end) {
    checkOutValue.textContent = formatDateBR(selection.end);
    checkOutValue.classList.remove('placeholder');
    modalCheckOutValue.textContent = formatDateBR(selection.end);
  } else {
    checkOutValue.textContent = 'Adicionar data';
    checkOutValue.classList.add('placeholder');
    modalCheckOutValue.textContent = 'DD/MM/AAAA';
  }

  modalFieldCheckIn.classList.toggle('active', !selection.start);
  modalFieldCheckOut.classList.toggle('active', !!selection.start && !selection.end);
}

// ---------- Modal ----------

function openModal(target) {
  if (calModalBackdrop) calModalBackdrop.hidden = false;
  if (calModal) calModal.hidden = false;
  renderCalendar();
  syncFieldDisplays();
}

function closeModal() {
  if (calModalBackdrop) calModalBackdrop.hidden = true;
  if (calModal) calModal.hidden = true;
}

// ---------- Calendário ----------

function renderCalendar() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  if (calPrevBtn) calPrevBtn.disabled = monthOffset === 0;
  if (calNextBtn) calNextBtn.disabled = monthOffset >= MAX_MONTH_OFFSET;

  // Com o check-in escolhido, o primeiro dia ocupado depois dele ainda serve de
  // checkout: o hóspede sai de manhã e o próximo entra à tarde.
  let checkoutOnly = null;
  if (selection.start && !selection.end) {
    checkoutOnly = [...blockedDays].filter((k) => k > selection.start).sort()[0] || null;
  }

  let html = '';
  for (let m = 0; m < MONTHS_SHOWN; m++) {
    const monthDate = new Date(today.getFullYear(), today.getMonth() + monthOffset + m, 1);
    const year = monthDate.getFullYear();
    const month = monthDate.getMonth();
    const firstWeekday = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();

    html += `<div class="cal-month"><h4>${MONTH_NAMES[month]} ${year}</h4><div class="cal-weekdays">`;
    WEEKDAYS.forEach((w) => (html += `<span>${w}</span>`));
    html += '</div><div class="cal-days">';
    for (let i = 0; i < firstWeekday; i++) html += '<span class="cal-day empty"></span>';

    for (let day = 1; day <= daysInMonth; day++) {
      const dateObj = new Date(year, month, day);
      const key = dateObj.toISOString().slice(0, 10);
      const isPast = dateObj < today;
      const isBlocked = blockedDays.has(key);

      let cls = 'cal-day';
      if (isPast) cls += ' past';
      else if (isBlocked && key !== checkoutOnly && key !== selection.end) cls += ' booked';
      else {
        cls += ' free selectable';
        if (selection.start === key) cls += ' range-start';
        if (selection.end === key) cls += ' range-end';
        if (selection.start && selection.end && key > selection.start && key < selection.end) cls += ' in-range';
      }

      html += `<span class="${cls}" data-date="${key}">${day}</span>`;
    }
    html += '</div></div>';
  }
  calGrid.innerHTML = html;

  calGrid.querySelectorAll('.cal-day.selectable').forEach((el) => {
    el.addEventListener('click', () => onDayClick(el.dataset.date));
  });
}

function onDayClick(dateKey) {
  clearError();

  const startingFresh = !selection.start || (selection.start && selection.end);
  if (startingFresh || dateKey <= selection.start) {
    selection = { start: dateKey, end: null };
    renderCalendar();
    hideBookingSteps();
    syncFieldDisplays();
    return;
  }

  if (hasBlockedDayInRange(selection.start, dateKey)) {
    showError('Essa faixa passa por uma data já ocupada. Escolha outro período.');
    selection = { start: dateKey, end: null };
    renderCalendar();
    syncFieldDisplays();
    return;
  }

  const nights = nightsBetween(selection.start, dateKey);
  if (nights < minNights) {
    showError(`Estadia mínima de ${minNights} noite${minNights > 1 ? 's' : ''}.`);
    return;
  }

  selection.end = dateKey;
  renderCalendar();
  syncFieldDisplays();
  loadQuote();
}

async function loadQuote() {
  // Fora do ?preview=1 o site não mostra preço: o valor sai na conversa do WhatsApp,
  // já com a oferta do momento quando houver. Só as datas vão na mensagem.
  if (!PREVIEW_MODE) {
    if (bookingWidgetCta) bookingWidgetCta.hidden = true;
    showWhatsappCta();
    return;
  }
  try {
    const res = await fetch(`${API_BASE}/api/pricing?checkIn=${selection.start}&checkOut=${selection.end}`);
    if (!res.ok) throw new Error('pricing failed');
    const quote = await res.json();
    lastQuote = quote;
    renderSummary(quote);
    showGuestForm();
  } catch (err) {
    if (PREVIEW_MODE) {
      showError('Não consegui calcular o preço agora. Tenta de novo em instantes.');
    } else {
      // Sem preço, ainda dá pra fechar: as datas vão na mensagem do WhatsApp.
      if (bookingWidgetCta) bookingWidgetCta.hidden = true;
      showWhatsappCta();
    }
  }
}

function renderSummary(quote) {
  if (!bookingSummary) return;
  if (bookingWidgetTitle) bookingWidgetTitle.hidden = true;
  bookingSummary.hidden = false;
  bookingSummary.innerHTML = `
    <div class="row"><span>${quote.nights} noite${quote.nights > 1 ? 's' : ''} × ${formatBRL(quote.nightlyRateCents)}</span><span>${formatBRL(quote.nightlyRateCents * quote.nights)}</span></div>
    <div class="row"><span>Taxa de limpeza</span><span>${formatBRL(quote.cleaningFeeCents)}</span></div>
    <div class="row total"><span>Total</span><span>${formatBRL(quote.totalCents)}</span></div>
    <p class="policy-note">${quote.cancellationPolicy.summary}</p>
  `;
  if (bookingWidgetCta) bookingWidgetCta.hidden = true;
}

function showGuestForm() {
  if (!guestForm) return;
  guestForm.hidden = false;

  const submitBtn = guestForm.querySelector('button[type="submit"]');
  if (!PREVIEW_MODE) {
    guestForm.hidden = true;
    showWhatsappCta();
  } else {
    submitBtn.disabled = false;
    if (bookingNote) bookingNote.hidden = true;
  }
}

function formatDateNumeric(iso) {
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

function whatsappMessage() {
  if (!selection.start || !selection.end) {
    return 'Olá! Vi o site do Studio 215 e quero reservar.';
  }
  const nights = nightsBetween(selection.start, selection.end);
  let msg = `Olá! Vi o site do Studio 215 e quero reservar de ${formatDateNumeric(selection.start)} a ${formatDateNumeric(selection.end)} ` +
    `(${nights} noite${nights > 1 ? 's' : ''}), ${guestCount} hóspede${guestCount > 1 ? 's' : ''}.`;
  if (lastQuote && lastQuote.totalCents) msg += ` O site mostrou total de ${formatBRL(lastQuote.totalCents)}.`;
  return msg;
}

function updateWhatsappLink() {
  if (!bookingWhatsapp) return;
  bookingWhatsapp.href = `https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(whatsappMessage())}`;
}

function showWhatsappCta() {
  updateWhatsappLink();
  if (bookingWhatsapp) bookingWhatsapp.hidden = false;
}

function hideBookingSteps() {
  lastQuote = null;
  const keepWhatsapp = availabilityFailed && !PREVIEW_MODE;
  if (bookingWhatsapp) bookingWhatsapp.hidden = !keepWhatsapp;
  if (keepWhatsapp) updateWhatsappLink();
  if (bookingWidgetTitle) bookingWidgetTitle.hidden = false;
  if (bookingWidgetCta) bookingWidgetCta.hidden = keepWhatsapp;
  if (bookingSummary) bookingSummary.hidden = true;
  if (guestForm) guestForm.hidden = true;
  if (bookingNote) bookingNote.hidden = true;
  clearError();
}

function showError(msg) {
  if (!bookingError) return;
  bookingError.textContent = msg;
  bookingError.hidden = false;
}

function clearError() {
  if (!bookingError) return;
  bookingError.hidden = true;
  bookingError.textContent = '';
}

// Mesmo algoritmo do backend (src/lib/cpf.ts) — checagem client-side é só UX,
// o servidor continua sendo a autoridade real.
function isValidCpfClient(rawValue) {
  const cpf = (rawValue || '').replace(/\D/g, '');
  if (cpf.length !== 11) return false;
  if (/^(\d)\1{10}$/.test(cpf)) return false;

  const checkDigit = (digits, weightStart) => {
    let sum = 0;
    for (let i = 0; i < digits.length; i++) sum += Number(digits[i]) * (weightStart - i);
    const remainder = sum % 11;
    return remainder < 2 ? 0 : 11 - remainder;
  };

  if (checkDigit(cpf.slice(0, 9), 10) !== Number(cpf[9])) return false;
  if (checkDigit(cpf.slice(0, 10), 11) !== Number(cpf[10])) return false;
  return true;
}

function reservationErrorMessage(body) {
  if (body.error === 'indisponivel') return 'Essas datas acabaram de ficar indisponíveis. Escolha outro período.';
  if (body.error === 'estadia_minima') return `Estadia mínima de ${body.minNights} noites.`;
  if (body.error === 'validacao') return 'Confira os dados preenchidos.';
  return 'Não consegui criar a pré-reserva agora. Tenta de novo em instantes.';
}

if (guestForm) {
  guestForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!PREVIEW_MODE) return; // reforço — o botão já vem desabilitado
    clearError();

    const payload = {
      checkIn: selection.start,
      checkOut: selection.end,
      guestName: guestForm.guestName.value.trim(),
      guestEmail: guestForm.guestEmail.value.trim(),
      guestPhone: guestForm.guestPhone.value.trim(),
      guestDocument: guestForm.guestDocument.value.trim(),
      guestCount,
    };

    if (!isValidCpfClient(payload.guestDocument)) {
      showError('CPF inválido — confira os números.');
      return;
    }

    const submitBtn = guestForm.querySelector('button[type="submit"]');
    submitBtn.disabled = true;

    try {
      const res = await fetch(`${API_BASE}/api/reservations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const body = await res.json();

      if (!res.ok) {
        showError(reservationErrorMessage(body));
        submitBtn.disabled = false;
        return;
      }

      sessionStorage.setItem(RESERVATION_ID_KEY, body.id);
      renderPaymentChoice(body);
    } catch (err) {
      showError('Não consegui enviar a pré-reserva agora. Tenta de novo em instantes.');
      submitBtn.disabled = false;
    }
  });
}

// ---------- Pagamento (Fase 3) ----------

// O security.js do Mercado Pago publica window.MP_DEVICE_SESSION_ID assim que
// carrega. Pode não existir (bloqueador de anúncios, script lento) — nesse
// caso o pagamento segue normalmente, só sem esse sinal de antifraude.
function getDeviceId() {
  return typeof window.MP_DEVICE_SESSION_ID === 'string' ? window.MP_DEVICE_SESSION_ID : undefined;
}

function paymentErrorMessage(body) {
  if (body.error === 'reserva_nao_pendente') return 'Essa pré-reserva não está mais disponível pra pagamento.';
  if (body.error === 'reserva_expirada') return 'Essa pré-reserva expirou. Escolha as datas de novo pra tentar outra vez.';
  if (body.error === 'validacao') return 'Confira os dados do pagamento.';
  if (body.error === 'falha_mercado_pago') return 'O Mercado Pago não respondeu agora. Tenta de novo em instantes.';
  return 'Não consegui processar o pagamento agora. Tenta de novo em instantes.';
}

function stopPaymentPolling() {
  if (paymentPollTimer) {
    clearInterval(paymentPollTimer);
    paymentPollTimer = null;
  }
}

function unmountCardBrick() {
  if (cardBrickController) {
    cardBrickController.unmount();
    cardBrickController = null;
  }
}

function showPaymentStatus(message, kind) {
  const el = document.getElementById('paymentStatus');
  if (!el) return;
  el.hidden = !message;
  el.textContent = message || '';
  el.className = 'payment-status' + (kind ? ` is-${kind}` : '');
}

function setPaymentMethodButtonsDisabled(disabled) {
  const pix = document.getElementById('choosePix');
  const card = document.getElementById('chooseCard');
  if (pix) pix.disabled = disabled;
  if (card) card.disabled = disabled;
}

function renderPaymentBackButton(reservation) {
  const panel = document.getElementById('paymentPanel');
  if (!panel) return;
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'payment-back-btn';
  btn.textContent = 'Escolher outro método de pagamento';
  btn.addEventListener('click', () => {
    stopPaymentPolling();
    unmountCardBrick();
    renderPaymentChoice(reservation);
  });
  panel.appendChild(btn);
}

function renderPaymentChoice(reservation) {
  stopPaymentPolling();
  unmountCardBrick();
  closeModal();
  if (bookingWidget) bookingWidget.hidden = true;
  if (guestForm) guestForm.hidden = true;
  if (bookingNote) bookingNote.hidden = true;
  clearError();

  if (!bookingConfirmation) return;
  const expires = new Date(reservation.expiresAt);

  bookingConfirmation.hidden = false;
  bookingConfirmation.innerHTML = `
    <h3>Pré-reserva feita</h3>
    <p>${formatDateBR(reservation.checkIn)} — ${formatDateBR(reservation.checkOut)}</p>
    <p>Total: ${formatBRL(reservation.totalCents)}</p>
    <p>${reservation.cancellationPolicy.summary}</p>
    <p>Escolha como pagar até ${expires.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })} pra garantir a data.</p>
    <div class="payment-methods">
      <button type="button" class="payment-method-btn" id="choosePix">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v4M12 17v4M3 12h4M17 12h4M7.5 7.5l2 2M14.5 14.5l2 2M16.5 7.5l-2 2M9.5 14.5l-2 2"/></svg>
        Pix
      </button>
      <button type="button" class="payment-method-btn" id="chooseCard">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20"/></svg>
        Cartão de crédito
      </button>
    </div>
    <div class="payment-panel" id="paymentPanel" hidden></div>
    <p class="payment-status" id="paymentStatus" hidden></p>
  `;

  const pixBtn = document.getElementById('choosePix');
  const cardBtn = document.getElementById('chooseCard');
  if (pixBtn) pixBtn.addEventListener('click', () => startPixPayment(reservation));
  if (cardBtn) cardBtn.addEventListener('click', () => startCardPayment(reservation));
}

function renderConfirmedSuccess(reservation) {
  stopPaymentPolling();
  unmountCardBrick();
  closeModal();
  if (bookingWidget) bookingWidget.hidden = true;
  if (guestForm) guestForm.hidden = true;
  if (bookingNote) bookingNote.hidden = true;
  clearError();

  if (!bookingConfirmation) return;
  bookingConfirmation.hidden = false;
  bookingConfirmation.innerHTML = `
    <h3>Reserva confirmada!</h3>
    <p>${formatDateBR(reservation.checkIn)} — ${formatDateBR(reservation.checkOut)}</p>
    <p>Total pago: ${formatBRL(reservation.totalCents)}</p>
    <p>Confirmamos por e-mail. Qualquer coisa, chama no WhatsApp.</p>
  `;
}

function pollPaymentStatus(reservationId) {
  stopPaymentPolling();
  paymentPollTimer = setInterval(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/reservations/${reservationId}`);
      if (!res.ok) return;
      const reservation = await res.json();

      if (reservation.status === 'confirmed') {
        renderConfirmedSuccess(reservation);
      } else if (reservation.status === 'expired' || reservation.status === 'cancelled') {
        stopPaymentPolling();
        showPaymentStatus(
          'Essa pré-reserva expirou antes do pagamento ser confirmado. Escolha as datas de novo pra tentar outra vez.',
          'error'
        );
        setPaymentMethodButtonsDisabled(true);
      } else if (reservation.status === 'confirmed_conflict' || reservation.status === 'refunded') {
        stopPaymentPolling();
        showPaymentStatus(
          'Essa data foi ocupada antes da confirmação do seu pagamento — o valor foi estornado automaticamente. Chame no WhatsApp que ajudamos a encontrar outra data.',
          'error'
        );
        setPaymentMethodButtonsDisabled(true);
      }
      // 'pending' — pagamento ainda em análise, continua tentando.
    } catch (err) {
      // rede falhou nesse tick, tenta de novo no próximo.
    }
  }, PAYMENT_POLL_INTERVAL_MS);
}

async function startPixPayment(reservation) {
  const panel = document.getElementById('paymentPanel');
  if (!panel) return;
  unmountCardBrick();
  setPaymentMethodButtonsDisabled(true);
  panel.hidden = false;
  panel.innerHTML = '';
  showPaymentStatus('Gerando código Pix...');

  try {
    const res = await fetch(`${API_BASE}/api/reservations/${reservation.id}/payments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ method: 'pix', deviceId: getDeviceId() }),
    });
    const body = await res.json();

    if (!res.ok) {
      showPaymentStatus(paymentErrorMessage(body), 'error');
      setPaymentMethodButtonsDisabled(false);
      return;
    }

    if (body.status === 'approved') {
      renderConfirmedSuccess({ ...reservation, status: 'confirmed' });
      return;
    }

    renderPixPanel(body, reservation);
    pollPaymentStatus(reservation.id);
  } catch (err) {
    showPaymentStatus('Não consegui gerar o Pix agora. Tenta de novo em instantes.', 'error');
    setPaymentMethodButtonsDisabled(false);
  }
}

function renderPixPanel(payment, reservation) {
  const panel = document.getElementById('paymentPanel');
  if (!panel) return;

  panel.innerHTML = `
    <div class="pix-qr-wrap">
      <img class="pix-qr" id="pixQrImg" alt="QR Code Pix">
    </div>
    <div class="pix-copy-row">
      <input type="text" readonly id="pixCopyField">
      <button type="button" class="btn btn-secondary" id="pixCopyBtn">Copiar código</button>
    </div>
  `;

  // Via propriedade JS, não atributo — evita qualquer problema de escaping
  // com o conteúdo do QR/base64.
  const img = document.getElementById('pixQrImg');
  if (img) img.src = `data:image/png;base64,${payment.qrCodeBase64}`;
  const field = document.getElementById('pixCopyField');
  if (field) field.value = payment.qrCode;

  const copyBtn = document.getElementById('pixCopyBtn');
  if (copyBtn) {
    copyBtn.addEventListener('click', () => {
      navigator.clipboard.writeText(payment.qrCode || '').then(() => {
        const original = copyBtn.textContent;
        copyBtn.textContent = 'Copiado!';
        setTimeout(() => {
          copyBtn.textContent = original;
        }, 2000);
      });
    });
  }

  renderPaymentBackButton(reservation);
  showPaymentStatus('Aguardando confirmação do pagamento...');
}

async function startCardPayment(reservation) {
  const panel = document.getElementById('paymentPanel');
  if (!panel) return;
  stopPaymentPolling();
  setPaymentMethodButtonsDisabled(true);
  panel.hidden = false;
  panel.innerHTML = '<div id="cardPaymentBrick"></div>';
  showPaymentStatus('');

  if (typeof MercadoPago === 'undefined') {
    showPaymentStatus('Não consegui carregar o pagamento por cartão agora. Tenta de novo em instantes.', 'error');
    setPaymentMethodButtonsDisabled(false);
    return;
  }

  let brickReady = false;

  try {
    const mp = new MercadoPago(MP_PUBLIC_KEY, { locale: 'pt-BR' });
    cardBrickController = await mp.bricks().create('cardPayment', 'cardPaymentBrick', {
      initialization: { amount: reservation.totalCents / 100 },
      customization: {
        paymentMethods: { creditCard: 'all', debitCard: 'excluded' },
      },
      callbacks: {
        onReady: () => {
          brickReady = true;
          setPaymentMethodButtonsDisabled(false);
        },
        onError: () => {
          showPaymentStatus('Não consegui carregar o formulário de cartão. Tenta de novo em instantes.', 'error');
          setPaymentMethodButtonsDisabled(false);
        },
        onSubmit: (cardFormData) => submitCardPayment(reservation, cardFormData),
      },
    });
    renderPaymentBackButton(reservation);

    // Rede de segurança: alguns modos de falha do SDK (chave inválida,
    // iframe bloqueado) não disparam onReady nem onError — só logam no
    // console e deixam o container vazio pra sempre. Sem isso os botões
    // ficam travados e o hóspede não vê nenhuma mensagem.
    setTimeout(() => {
      const container = document.getElementById('cardPaymentBrick');
      if (!brickReady && container && container.childElementCount === 0) {
        showPaymentStatus('Não consegui carregar o formulário de cartão. Tenta de novo em instantes.', 'error');
        setPaymentMethodButtonsDisabled(false);
      }
    }, 6000);
  } catch (err) {
    showPaymentStatus('Não consegui carregar o pagamento por cartão agora. Tenta de novo em instantes.', 'error');
    setPaymentMethodButtonsDisabled(false);
  }
}

async function submitCardPayment(reservation, cardFormData) {
  showPaymentStatus('Processando pagamento...');

  let res, body;
  try {
    res = await fetch(`${API_BASE}/api/reservations/${reservation.id}/payments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        method: 'credit_card',
        token: cardFormData.token,
        installments: cardFormData.installments,
        paymentMethodId: cardFormData.payment_method_id,
        issuerId: cardFormData.issuer_id,
        deviceId: getDeviceId(),
      }),
    });
    body = await res.json();
  } catch (err) {
    showPaymentStatus('Não consegui processar o pagamento agora. Tenta de novo em instantes.', 'error');
    throw err;
  }

  if (!res.ok) {
    showPaymentStatus(paymentErrorMessage(body), 'error');
    throw new Error(body.error || 'falha_pagamento');
  }

  if (body.status === 'approved') {
    renderConfirmedSuccess({ ...reservation, status: 'confirmed' });
    return;
  }

  if (body.status === 'rejected') {
    showPaymentStatus('Pagamento recusado. Confira os dados do cartão ou tente outro cartão.', 'error');
    throw new Error('pagamento_recusado');
  }

  // in_process/pending/authorized — aguarda confirmação (webhook ou próximo poll).
  showPaymentStatus('Pagamento em análise — aguardando confirmação...');
  pollPaymentStatus(reservation.id);
}
