import type { FormEvent } from 'react';
import { useStore } from '../state/store';
import { CONSENT_SHORT, OFFER_NOTE, MARKETING_CONSENT } from '../data/legal';
import { Branch, Crown } from '../components/Icon';
import { Monogram } from '../components/Logo';
import './Splash.css';

const BRANCH_TOP = 'calc(var(--sat) + 60px)';

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

  // Enter в поле = кнопка текущего шага
  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (loginStep === 'phone') { if (consentGiven) sendCode(); }
    else if (loginStep === 'code') confirmCode();
    else finishLogin();
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
                onChange={e => setPhoneInput(e.target.value)}
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

              <button type="submit" className="btn btn--primary btn--block" disabled={!consentGiven}>ПОЛУЧИТЬ КОД</button>
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
              <button type="submit" className="btn btn--primary btn--block">ПОДТВЕРДИТЬ</button>
              <div className="splash__note">Пока подходит любой код из 4 цифр</div>
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
              <button type="submit" className="btn btn--primary btn--block">ГОТОВО</button>
            </>
          )}
        </form>
      </div>
    </div>
  );
}
