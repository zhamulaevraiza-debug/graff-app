/**
 * Уведомление о данных, которые приложение хранит на устройстве.
 *
 * Отдельного закона про такие баннеры в России нет, но 152-ФЗ обязывает кафе
 * рассказать, какие данные обрабатываются (ст. 14) и держать политику на виду
 * (ст. 18.1 ч. 2 п. 2). Хранится только необходимое для заказа, поэтому спрашивать
 * согласие здесь не нужно — достаточно сообщить и дать ссылку на подробности.
 *
 * Показывается один раз: отметка о закрытии лежит в том же хранилище, о котором речь.
 */
import { useStore } from '../state/store';
import './StorageNotice.css';

export function StorageNotice() {
  const pending = useStore(s => s.storageNoticeAt === null);
  // Пока человек читает сам документ, карточка только мешает — она и так про него.
  const reading = useStore(s => s.screen === 'legal' && s.legalDoc === 'storage');
  const dismiss = useStore(s => s.dismissStorageNotice);
  const openLegal = useStore(s => s.openLegal);
  if (!pending || reading) return null;

  return (
    // Не dialog: карточка ничего не перекрывает и не держит фокус — это сообщение, а не запрос.
    <section className="storage-notice" aria-labelledby="storage-notice-title">
      <div className="storage-notice__card">
        <h2 className="storage-notice__title" id="storage-notice-title">Данные на этом устройстве</h2>
        <p className="storage-notice__text">
          Приложение хранит в браузере только то, без чего не работает заказ: корзину, ваш заказ и вход.
          Файлов cookie, рекламы и слежки нет.{' '}
          <button type="button" className="storage-notice__more" onClick={() => openLegal('storage')}>
            Подробнее
          </button>
        </p>
        <button type="button" className="btn btn--primary btn--block" onClick={dismiss}>
          ПОНЯТНО
        </button>
      </div>
    </section>
  );
}
