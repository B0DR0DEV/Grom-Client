# Как выпускать релиз

## Один раз: выложить код

1. Создай на GitHub **публичный** репозиторий `Grom-Client` (или очисти существующий: сейчас там только файл `VISIT_RELEASES`).
2. Перед первым пушем удали из папки проекта:
   - `pnpm-lock.yaml` и `pnpm-workspace.yaml` — они устарели (в них ещё `vite-plugin-node-polyfills`), сборка идёт через npm и `package-lock.json`;
   - убедись, что `node_modules`, `dist`, `release` не попадут в репозиторий (их отсекает `.gitignore`).
3. Отправь код:
   ```bat
   git init
   git add .
   git commit -m "Grom Client: open source"
   git branch -M main
   git remote add origin https://github.com/B0DR0DEV/Grom-Client.git
   git push -u origin main
   ```
4. Во вкладке **Actions** должна пройти «Build check (Windows)». Если упала — открой лог, там будет ошибка сборки.

## Каждый релиз

1. Поменяй `"version"` в `package.json` (например, `1.5.2`), закоммить и запушь.
2. Поставь тег с той же версией и запушь его:
   ```bat
   git tag v1.5.2
   git push origin v1.5.2
   ```
3. Через ~5–10 минут во вкладке **Releases** появится релиз с `Grom-Client-Setup-1.5.2.exe` и `SHA256SUMS.txt`.
4. Обнови ссылку на сайте. Лучше вести на страницу `https://github.com/B0DR0DEV/Grom-Client/releases/latest` — тогда сайт не придётся менять при каждом релизе.
5. Обнови версию в Supabase (`launcher_control`), чтобы старые лаунчеры предложили обновиться.

## Подпись кода (убирает «Неизвестный издатель»)

**SignPath Foundation** бесплатно подписывает open-source проекты.

1. Условия: открытый код под OSI-лицензией (у нас MIT), сборка в CI (есть), понятное описание проекта и политики конфиденциальности (README и PRIVACY.md есть).
2. Подай заявку на сайте SignPath Foundation (раздел для open-source проектов).
3. После одобрения они дадут organization ID, project slug и токен. Токен положи в **Settings → Secrets → Actions** как `SIGNPATH_API_TOKEN`.
4. В `release.yml` на месте комментария «Сюда позже встанет подпись SignPath» добавь шаги из их инструкции: загрузить неподписанный `.exe` как artifact и вызвать `signpath/github-action-submit-signing-request`.

Сертификат копит «репутацию» в SmartScreen: первые недели предупреждение может ещё появляться, потом пропадёт.

## Если антивирус ругается

- Microsoft Defender: отправь файл как ложное срабатывание через форму **Submit a file** на сайте Microsoft Security Intelligence (вариант «Software developer»).
- Kaspersky, Avast/AVG, ESET и другие — у каждого есть форма «false positive». Смотри, кто срабатывает на VirusTotal, и пиши именно им.
- Указывай ссылку на репозиторий и аттестацию — это сильно ускоряет разбор.
