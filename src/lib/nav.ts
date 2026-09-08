/**
 * Кнопка «назад» внутри приложения.
 *
 * Если предыдущий экран есть в истории браузера, возвращаемся по ней — тогда системная кнопка «назад»
 * (и жест на iOS) не открывает заново только что закрытый экран. Если истории нет (приложение открыли
 * сразу по ссылке на этот экран), выполняем запасной переход.
 */
export function appBack(fallback: () => void) {
  const state = typeof history !== 'undefined' ? (history.state as { graff?: boolean } | null) : null;
  if (state?.graff) history.back();
  else fallback();
}
