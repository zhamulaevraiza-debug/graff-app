import { FORMATS } from '../data/menu';
import { Icon } from './Icon';
import { useStore } from '../state/store';

/** Три карточки-переключателя формата получения: В зале / На террасе / С собой (главная и корзина). */
export function FormatPicker() {
  const format = useStore(s => s.format);
  const pickFormat = useStore(s => s.pickFormat);
  return (
    <div className="grid-3" role="radiogroup" aria-label="Формат получения">
      {FORMATS.map(f => {
        const act = format === f.id;
        return (
          <button
            key={f.id}
            type="button"
            role="radio"
            aria-checked={act}
            onClick={() => pickFormat(f.id)}
            style={{
              display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 5, padding: '10px 6px',
              borderRadius: 14, border: `1px solid ${act ? 'var(--copper)' : 'var(--line)'}`,
              background: act ? 'var(--grad)' : '#fff', color: act ? '#fff' : 'var(--text)',
              cursor: 'pointer', font: '500 14px var(--f-body)', whiteSpace: 'nowrap',
            }}
          >
            <Icon d={f.icon} size={22} color={act ? '#fff' : 'var(--text)'} />
            {f.name}
          </button>
        );
      })}
    </div>
  );
}
