# Privacy policy — Tabbs

*Last updated: October 26, 2026*

Tabbs does not collect, sell or send any data. It makes no network requests, has no analytics or ads, and loads no remote code. Everything it works with stays in your browser.

## What the extension stores, and where

- **Your folders and links** are ordinary browser bookmarks in the folder “Tabbs” inside “Other bookmarks”. If you have bookmark sync turned on, your browser syncs them like any other bookmarks; the extension itself sends nothing.
- **Small settings** in the browser’s local extension storage: the id of that folder, which folders are expanded, which pictogram a folder or space has, which folders are spaces, which setup steps you ticked on the welcome page, and whether the browser was last in the light or the dark theme (to pick the toolbar icon). While you sort an import from Arc, also which bookmarks it brought.
- **Which tab belongs to which link**, and which space is open in each window, in session storage that the browser clears when it quits.
- **Arc’s sidebar file**, if you choose it for the import, is read in the browser and not kept: only the bookmarks made from it stay.

Removing the extension deletes its storage. Your bookmarks stay.

## Permissions

- `sidePanel` — to show the panel.
- `bookmarks` — to read and edit the folders and links in its own folder. Other bookmarks are not changed, with one exception you start yourself: after the browser’s own import from Arc, Tabbs can move the imported bookmarks into its folder and then removes the emptied import folder.
- `tabs` — to show the open tabs of the window, switch to them, open and close them, and match links to tabs by address.
- `storage` — for the settings and tab matches above.
- `favicon` — to show site icons from the browser’s own cache, without loading them from the internet.
- `tabGroups`, optional — asked only when you turn on spaces: each space keeps its tabs in a tab group.

## Contact

Questions: open an issue in the project’s repository on GitHub.

---

# Политика конфиденциальности — Tabbs

*Обновлено: 26 октября 2026 года*

Tabbs не собирает, не продаёт и никуда не отправляет данные. Расширение не делает запросов в сеть, в нём нет аналитики и рекламы, оно не загружает код из интернета. Всё, с чем оно работает, остаётся в браузере.

## Что расширение хранит и где

- **Папки и ссылки** — обычные закладки браузера в папке «Tabbs» внутри «Других закладок». Если в браузере включена синхронизация закладок, браузер синхронизирует их, как любые другие; само расширение ничего не отправляет.
- **Мелкие настройки** — в локальном хранилище расширения: id этой папки, какие папки раскрыты, какие пиктограммы у папок и пространств, какие папки стали пространствами, какие шаги настройки отмечены на странице приветствия и какая тема была у браузера в последний раз — светлая или тёмная (чтобы выбрать значок кнопки на панели инструментов). Пока вы раскладываете импорт из Arc — ещё и какие закладки он принёс.
- **Какая вкладка принадлежит какой ссылке** и какое пространство открыто в каждом окне — в хранилище сеанса, которое браузер очищает при выходе.
- **Файл боковой панели Arc**, если выбрать его для импорта, читается в браузере и не сохраняется: остаются только сделанные из него закладки.

При удалении расширения его хранилище удаляется. Закладки остаются.

## Разрешения

- `sidePanel` — показать боковую панель.
- `bookmarks` — читать и менять папки и ссылки в своей папке. Остальные закладки не меняются, с одним исключением, которое запускаете вы сами: после родного импорта браузера из Arc Tabbs может перенести импортированные закладки в свою папку и удаляет опустевшую папку импорта.
- `tabs` — показать открытые вкладки окна, переключаться на них, открывать и закрывать, сопоставлять ссылки с вкладками по адресу.
- `storage` — для настроек и привязок вкладок, описанных выше.
- `favicon` — показывать иконки сайтов из кэша самого браузера, не загружая их из интернета.
- `tabGroups`, необязательное — запрашивается, только когда вы включаете пространства: каждое пространство держит свои вкладки в группе вкладок.

## Связь

Вопросы — через issue в репозитории проекта на GitHub.
