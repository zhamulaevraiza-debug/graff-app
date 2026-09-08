import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useStore, LIVE } from '../state/store';
import { CONSENT_SHORT, OFFER_NOTE, MARKETING_CONSENT } from '../data/legal';
import { Branch, Crown } from '../components/Icon';
import { Monogram } from '../components/Logo';
import './Splash.css';

const BRANCH_TOP = 'calc(var(--sat) + 60px)';
/** сколько секунд ждать до повторной отправки кода */
const RESEND_SEC = 60;

/** Сплэш / вход: логотип, слоган и карточка «вход по номеру → код из SMS → имя». */
export function Splash() {
  const loginStep = useStore(s => s.loginStep);
  const phoneInput = useStore(s => s.phoneInput);
  const codeInput = useStore(s => s.codeInput);
  const nameInput = useStore(s => s.nameInput);
  const phoneErr = useStore(s => s.phoneErr);
  const setPhoneInput = useStore(s => s.setPhoneInput);
  const setCodeInput = useStore(s => s.setCodeInput);
  const setNameInput = useStore(s => s.setNameInput);
  const sendCode = useStore(s => s.sendCode);
  const backToPhone = useStore(s => s.backToPhone);
  const confirmCode = useStore(s => s.confirmCode);
  const finishLogin = useStore(s => s.finishLogin);
  const skipLogin = useStore(s => s.skipLogin);
  const consentGiven = useStore(s => !!s.consentAt);
  const setConsent = useStore(s => s.setConsent);
  const openLegal = useStore(s => s.openLegal);
  const marketing = useStore(s => s.marketingConsent);
  const setMarketing = useStore(s => s.setMarketing);
  const netError = useStore(s => s.netError);
  const busy = useStore(s => s.busy);
  const setNetError = useStore(s => s.setNetError);

  // секунды до повторной отправки кода; resendTick перезапускает отсчёт после нажатия
  const [resendLeft, setResendLeft] = useState(0);
  const [resendTick, setResendTick] = useState(0);
  // момент отправки кода: отсчёт ведём по часам, а не счётчиком
  const sentAt = useRef(0);
  // идёт повторная отправка кода (а не проверка введённого)
  const resendPending = useRef(false);
  const prevBusy = useRef(busy);

  // ошибка сервера относится к прошлому шагу входа — на новом шаге её не показываем
  useEffect(() => { setNetError(null); }, [loginStep, setNetError]);

  // отсчёт «Отправить ещё раз через N с»: 60 секунд после каждой отправки кода
  useEffect(() => {
    if (!LIVE || loginStep !== 'code') { setResendLeft(0); return; }
    sentAt.current = Date.now();
    setResendLeft(RESEND_SEC);
    // считаем от метки времени: в свёрнутом приложении таймер притормаживают, а часы идут
    const left = () => Math.max(0, RESEND_SEC - Math.floor((Date.now() - sentAt.current) / 1000));
    const step = () => {
      const v = left();
      setResendLeft(v);
      if (v === 0) clearInterval(id); // отсчёт кончился — тикать больше незачем
    };
    const id = setInterval(step, 1000);
    // гость уходил читать SMS — на возврате пересчитываем остаток
    const onVis = () => { if (document.visibilityState === 'visible') step(); };
    document.addEventListener('visibilitychange', onVis);
    return () => { clearInterval(id); document.removeEventListener('visibilitychange', onVis); };
  }, [loginStep, resendTick]);

  // повторная отправка не удалась — SMS не ушла, значит и ждать минуту незачем
  useEffect(() => {
    const was = prevBusy.current;
    prevBusy.current = busy;
    if (!was || busy || !resendPending.current) return;
    resendPending.current = false;
    if (netError) { sentAt.current = 0; setResendLeft(0); }
  }, [busy, netError]);

  // Enter в поле = кнопка текущего шага
  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (busy) return;
    if (loginStep === 'phone') { if (consentGiven) sendCode(); }
    else if (loginStep === 'code') confirmCode();
    else finishLogin();
  };

  // ввод номера: старая ошибка сервера уже не про этот номер
  const onPhoneChange = (v: string) => {
    if (netError) setNetError(null);
    setPhoneInput(v);
  };

  // повторная отправка кода (только боевой режим)
  const onResend = () => {
    if (busy || resendLeft > 0) return;
    setNetError(null);
    resendPending.current = true;
    setResendTick(t => t + 1);
    sendCode();
  };

  return (
    <div className="screen screen--nonav splash">
      <Branch style={{ position: 'absolute', left: 16, top: BRANCH_TOP }} />
      <Branch mirror style={{ position: 'absolute', right: 16, top: BRANCH_TOP }} />

      <div className="splash__col">
        <Crown width={36} strokeWidth={1.4} />
        <Monogram size={108} strokeWidth={3.4} style={{ marginTop: 6 }} />
        <div className="splash__logo">GRAFF</div>
        <div className="splash__fd">FAST &amp; DELICIOUS</div>
        <div className="splash__hand">Вкус · Качество · Скорость</div>

        <div className="splash__spacer" />

        <form className="splash__card" onSubmit={onSubmit} noValidate>
          {loginStep === 'phone' && (
            <>
              <h2 className="t-head">ВХОД ПО НОМЕРУ</h2>
              <div className="t-sec t-pretty">Пришлём SMS с кодом. История заказов, избранное и статус заказа по звонку будут в профиле.</div>
              <input
                className={'input' + (phoneErr ? ' input--err' : '')}
                type="tel"
                inputMode="tel"
                autoComplete="tel"
                enterKeyHint="send"
                placeholder="+7 ___ ___-__-__"
                aria-label="Номер телефона"
                aria-invalid={phoneErr || undefined}
                value={phoneInput}
                onChange={e => onPhoneChange(e.target.value)}
              />
              {phoneErr && <div className="field-err" role="alert">Введите номер полностью — 10 цифр после +7</div>}

              {/* Согласие на обработку персональных данных — без него вход недоступен (152-ФЗ, ст. 9) */}
              <div className="splash__consent">
                <input
                  id="graff-consent"
                  type="checkbox"
                  className="splash__checkbox"
                  checked={consentGiven}
                  onChange={e => setConsent(e.target.checked)}
                />
                <label htmlFor="graff-consent">{CONSENT_SHORT}</label>
              </div>
              {/* Реклама — отдельное согласие, по умолчанию снято и вход не блокирует (ФЗ «О рекламе», ст. 18) */}
              <div className="splash__consent">
                <input
                  id="graff-marketing"
                  type="checkbox"
                  className="splash__checkbox"
                  checked={marketing}
                  onChange={e => setMarketing(e.target.checked)}
                />
                <label htmlFor="graff-marketing">{MARKETING_CONSENT}</label>
              </div>

              <div className="splash__legal-links">
                <button type="button" className="splash__link" onClick={() => openLegal('consent')}>Текст согласия</button>
                <span aria-hidden="true"> · </span>
                <button type="button" className="splash__link" onClick={() => openLegal('privacy')}>Политика данных</button>
                <span aria-hidden="true"> · </span>
                <button type="button" className="splash__link" onClick={() => openLegal('terms')}>Оферта</button>
              </div>

              <button type="submit" className="btn btn--primary btn--block" disabled={!consentGiven || busy}>
                {busy ? 'ОТПРАВЛЯЕМ…' : 'ПОЛУЧИТЬ КОД'}
              </button>
              {netError && <div className="field-err" role="alert">{netError}</div>}
              <div className="splash__note">{OFFER_NOTE}</div>
              <button type="button" className="btn btn--ghost" onClick={skipLogin}>Продолжить без входа</button>
            </>
          )}

          {loginStep === 'code' && (
            <>
              <h2 className="t-head">КОД ИЗ SMS</h2>
              <div className="t-sec">
                Отправили на {phoneInput} ·{' '}
                <button type="button" className="splash__link" onClick={backToPhone}>изменить</button>
              </div>
              <input
                className="input input--code"
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                enterKeyHint="done"
                pattern="[0-9]*"
                maxLength={4}
                placeholder="••••"
                aria-label="Код из SMS"
                value={codeInput}
                onChange={e => setCodeInput(e.target.value)}
                autoFocus
              />
              {netError && <div className="field-err" role="alert">{netError}</div>}
              <button type="submit" className="btn btn--primary btn--block" disabled={busy}>
                {busy && !resendPending.current ? 'ПРОВЕРЯЕМ…' : 'ПОДТВЕРДИТЬ'}
              </button>
              <div className="splash__note">
                {LIVE ? `Код придёт в SMS на ${phoneInput}` : 'Пока подходит любой код из 4 цифр'}
              </div>
              {/* повторная отправка — только в боевом режиме, не чаще раза в минуту */}
              {LIVE && (
                <button
                  type="button"
                  className="splash__resend"
                  onClick={onResend}
                  disabled={busy || resendLeft > 0}
                >
                  {resendLeft > 0 ? `Отправить ещё раз через ${resendLeft} с` : 'Отправить код ещё раз'}
                </button>
              )}
            </>
          )}

          {loginStep === 'name' && (
            <>
              <h2 className="t-head">КАК ВАС ЗОВУТ?</h2>
              <input
                className="input"
                type="text"
                autoComplete="given-name"
                enterKeyHint="done"
                placeholder="Имя"
                aria-label="Имя"
                value={nameInput}
                onChange={e => setNameInput(e.target.value)}
                autoFocus
              />
              {netError && <div className="field-err" role="alert">{netError}</div>}
              <button type="submit" className="btn btn--primary btn--block" disabled={busy}>ГОТОВО</button>
            </>
          )}
        </form>
      </div>
    </div>
  );
}
