import { useStore } from '../state/store';
import { Monogram } from './Logo';

/** Push-баннер «как системное уведомление» — сверху экрана, тап ведёт на экран заказа/персонала. */
export function Toast() {
  const toast = useStore(s => s.toast);
  const toastTap = useStore(s => s.toastTap);
  if (!toast) return null;
  return (
    <div className="toast" key={toast.id} role="status" aria-live="polite">
      <button
        type="button"
        className="toast__tap"
        onClick={toastTap}
        aria-label={`${toast.title} ${toast.text}. Открыть заказ`}
      >
        <div className="toast__icon"><Monogram size={26} color="#fff" /></div>
        <div className="grow">
          <div className="toast__meta"><span>GRAFF</span><span>сейчас</span></div>
          <div className="toast__title">{toast.title}</div>
          <div className="toast__text">{toast.text}</div>
        </div>
      </button>
    </div>
  );
}
