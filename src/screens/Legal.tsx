/**
 * Правовая информация: политика обработки персональных данных, оферта, согласие, реквизиты.
 * Список документов и просмотр одного документа — на одном экране (state.legalDoc).
 */
import { useStore } from '../state/store';
import { LEGAL_DOCS, LEGAL_UPDATED, legalDoc as findDoc, COMPANY } from '../data/legal';
import { Icon } from '../components/Icon';
import { BackButton, PlateTitle, ScriptTitle } from '../components/Titles';
import { appBack } from '../lib/nav';
import './Legal.css';

export function Legal() {
  const docId = useStore(s => s.legalDoc);
  const openLegal = useStore(s => s.openLegal);
  const go = useStore(s => s.go);
  const script = useStore(s => s.settings.headerStyle === 'script');
  const doc = docId ? findDoc(docId) : undefined;

  return (
    <div className="screen screen--gutter">
      <div className="row gap-10">
        <BackButton onClick={() => (doc ? openLegal(null) : appBack(() => go('profile')))} />
        {script
          ? <ScriptTitle size={32} crown={false}>{doc ? doc.title : 'Документы'}</ScriptTitle>
          : <PlateTitle icon="receipt">{doc ? 'ДОКУМЕНТ' : 'ДОКУМЕНТЫ'}</PlateTitle>}
      </div>

      {!doc && (
        <>
          <p className="t-sec t-pretty mt-14">
            Здесь собраны документы, которые описывают, как мы принимаем заказы и обращаемся с вашими данными.
          </p>
          <nav className="list mt-14" aria-label="Правовые документы">
            {LEGAL_DOCS.map(d => (
              <button key={d.id} type="button" className="list__row legal-row" onClick={() => openLegal(d.id)}>
                <Icon name="receipt" size={22} />
                <span className="list__grow">
                  <span className="legal-row__title">{d.title}</span>
                  <span className="list__sub">{d.hint}</span>
                </span>
                <Icon name="chevron" size={18} strokeWidth={1.8} />
              </button>
            ))}
          </nav>
          <p className="t-small mt-14">
            Вопросы по документам: <a href={`tel:${COMPANY.phone.replace(/[^\d+]/g, '')}`}>{COMPANY.phone}</a>
          </p>
        </>
      )}

      {doc && (
        <article className="legal-doc">
          <h1 className="legal-doc__title">{doc.title}</h1>
          <div className="t-small">Редакция от {LEGAL_UPDATED}</div>
          {doc.body.map((b, i) => (
            <section key={i} className="legal-doc__block">
              {b.h && <h2 className="legal-doc__h">{b.h}</h2>}
              {b.p?.map((text, j) => <p key={j} className="legal-doc__p">{text}</p>)}
              {b.ul && (
                <ul className="legal-doc__ul">
                  {b.ul.map((li, j) => <li key={j}>{li}</li>)}
                </ul>
              )}
            </section>
          ))}
          <button type="button" className="btn btn--secondary btn--block mt-20" onClick={() => openLegal(null)}>
            К списку документов
          </button>
        </article>
      )}
    </div>
  );
}
