# Шрифты

Файлы в этой папке приложение раздаёт само. К серверам Google оно не обращается:
адрес гостя никуда не уходит, а меню открывается своим шрифтом даже без доступа
к внешним сервисам.

Собираются командой из корня проекта:

```bash
node scripts/fonts.mjs
```

Скрипт скачивает нужные начертания, оставляет только кириллицу и латиницу
и пишет рядом `fonts.css` с правилами `@font-face`. Руками эти файлы не правят.

## Что используется

| Семейство | Начертания | Где в приложении |
|---|---|---|
| Playfair Display | 900 | суммы и крупные числа (`--f-logo`) |
| Oswald | 500, 700 | заголовки экранов (`--f-head`) |
| Roboto Condensed | 400, 500, 700 | основной текст (`--f-body`) |
| Montserrat | 500, 600 | подписи вразрядку (`--f-caps`) |
| Marck Script | 400 | рукописные заголовки (`--f-script`) |
| Caveat | 500, 600 | рукописные подписи (`--f-hand`) |

Набор начертаний задан в `scripts/fonts.mjs`. Если в оформлении появится новый вес,
его нужно добавить туда и пересобрать — иначе браузер подставит ближайший и текст
будет выглядеть иначе.

## Лицензии

Все шесть семейств распространяются по [SIL Open Font License 1.1](https://openfontlicense.org),
которая прямо разрешает размещать шрифты на своём сайте, в том числе в коммерческом проекте.
Требования лицензии: не продавать сами файлы шрифтов отдельно и не переименовывать
производные под тем же именем — мы ни того, ни другого не делаем.

Источник и авторы:

- **Playfair Display** — Claus Eggers Sørensen, [Google Fonts](https://fonts.google.com/specimen/Playfair+Display)
- **Oswald** — Vernon Adams, Kalapi Gajjar, Cyreal, [Google Fonts](https://fonts.google.com/specimen/Oswald)
- **Roboto Condensed** — Christian Robertson, [Google Fonts](https://fonts.google.com/specimen/Roboto+Condensed)
- **Montserrat** — Julieta Ulanovsky и другие, [Google Fonts](https://fonts.google.com/specimen/Montserrat)
- **Marck Script** — Denis Masharov, [Google Fonts](https://fonts.google.com/specimen/Marck+Script)
- **Caveat** — Impallari Type, [Google Fonts](https://fonts.google.com/specimen/Caveat)
