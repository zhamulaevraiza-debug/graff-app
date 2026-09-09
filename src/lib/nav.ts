/**
 * Кнопка «назад» внутри приложения.
 *
 * Если предыдущий экран есть в истории браузера, возвращаемся по ней — тогда системная кнопка «назад»
 * (и жест на iOS) не открывает заново только что закрытый экран. Если истории нет (приложение открыли
 * сразу по ссылке на этот экран), выполняем запасной переход.
 */
/**
 * Иногда экран закрывается без записи в истории — например, документ, открытый прямой ссылкой.
 * Тогда переход должен ЗАМЕНИТЬ текущую запись, иначе следующее «назад» вернёт закрытый экран.
 */
let replaceNext = false;
export const replaceHistoryEntry = () => { replaceNext = true; };
export const takeReplaceHistoryEntry = () => { const v = replaceNext; replaceNext = false; return v; };

export function appBack(fallback: () => void) {
  const state = typeof history !== 'undefined' ? (history.state as { graff?: boolean } | null) : null;
  if (state?.graff) history.back();
  else fallback();
}
