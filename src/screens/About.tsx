import { useStore } from '../state/store';
import { ADDRESS, HOURS, MAPS_URL, PHONE_DISPLAY, PHONE_TEL, REGION, TOWN } from '../data/menu';
import { Icon } from '../components/Icon';
import { Photo } from '../components/Photo';
import { BackButton, PlateTitle, ScriptTitle } from '../components/Titles';
import { appBack } from '../lib/nav';
import { CallButton } from '../components/CallButton';
import { Promises } from '../components/Promises';
import { COMPANY } from '../data/legal';
import './About.css';

/** «О нас / контакты»: адрес, карта, часы, телефон, кнопки «Позвонить» и «Маршрут», фото зала и террасы, обещания бренда. */
export function About() {
  const go = useStore(s => s.go);
  const openLegal = useStore(s => s.openLegal);
  const headerStyle = useStore(s => s.settings.headerStyle);

  return (
    <div className="screen screen--gutter">
      <div className="row gap-10">
        <BackButton onClick={() => appBack(() => go('home'))} />
        {/* В макете рукописный заголовок «О нас» — без короны (в отличие от корзины и статуса). */}
        {headerStyle === 'script'
          ? <ScriptTitle size={36} crown={false}>О нас</ScriptTitle>
          : <PlateTitle icon="pin">О НАС</PlateTitle>}
      </div>

      <a className="about-map" href={MAPS_URL} target="_blank" rel="noopener" aria-label="Открыть карту">
        <Photo id="about-map" height={160} radius={16} placeholder={'Карта · ' + TOWN + ', ' + ADDRESS} icon="pin" />
      </a>

      <div className="card card--beige about-contact">
        <div className="about-contact__row">
          <Icon name="pin" size={22} />
          <div>
            <div className="about-contact__main">{ADDRESS}</div>
            <div className="t-small">{TOWN}, {REGION}</div>
          </div>
        </div>
        <div className="about-contact__row">
          <Icon name="clock" size={22} />
          <div>
            <div className="about-contact__main">{HOURS}</div>
            <div className="t-small">ежедневно</div>
          </div>
        </div>
        <a className="about-contact__row" href={PHONE_TEL}>
          <Icon name="phone" size={22} />
          <div>
            <div className="about-contact__main">{PHONE_DISPLAY}</div>
            <div className="t-small">заказ по телефону — статус увидите в приложении</div>
          </div>
        </a>
      </div>

      <div className="grid-2 about-actions">
        <CallButton variant="primary">ПОЗВОНИТЬ</CallButton>
        <a className="btn btn--secondary" href={MAPS_URL} target="_blank" rel="noopener" style={{ height: 48, fontSize: 15, letterSpacing: '.06em' }}>
          МАРШРУТ
        </a>
      </div>

      <div className="grid-2 about-photos">
        <div>
          <Photo id="about-hall" height={120} radius={14} placeholder="Фото зала" icon="chair" />
          <div className="about-caption">Зал · столики 7–14</div>
        </div>
        <div>
          <Photo id="about-terrace" height={120} radius={14} placeholder="Фото террасы" icon="sun" />
          <div className="about-caption">Терраса · столики 1–6</div>
        </div>
      </div>

      <Promises variant="footer" style={{ marginTop: 18 }} />

      {/* Сведения об исполнителе — обязательны к доведению до потребителя (ЗоЗПП, ст. 9) */}
      <section className="about-legal" aria-label="Сведения об исполнителе">
        <h2 className="t-caps">Исполнитель</h2>
        <dl className="about-legal__list">
          <div><dt>Наименование</dt><dd>{COMPANY.legalName}</dd></div>
          <div><dt>ИНН</dt><dd>{COMPANY.inn}</dd></div>
          <div><dt>ОГРН (ОГРНИП)</dt><dd>{COMPANY.ogrn}</dd></div>
          <div><dt>Адрес</dt><dd>{COMPANY.legalAddress}</dd></div>
          <div><dt>Режим работы</dt><dd>{COMPANY.hours}</dd></div>
        </dl>
        <button type="button" className="btn btn--secondary btn--block btn--sm about-legal__btn" onClick={() => openLegal(null)}>
          Правовая информация
        </button>
      </section>

      <div className="about-thanks">Спасибо, что выбираете нас!</div>
    </div>
  );
}
