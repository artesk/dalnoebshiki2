# dalnoebshiki2
Расширение под chrome, для олдскульного перемещения по google street view
![overlay](https://github.com/artesk/dalnoebshiki2/assets/1773067/3cdf693b-2305-4db5-96cd-e996f227320f)


*Шаги для тестирования расширения*:
1. Откройте Chrome и перейдите на chrome://extensions/.
2. Включите режим разработчика в правом верхнем углу.
3. Нажмите "Загрузить распакованное расширение" и выберите папку с вашим проектом.
4. Перейдите на Google Maps и войдите в режим Street View, чтобы увидеть оверлей кабины грузовика.

## Обновление HUD

Верхняя панель построена на HTML и CSS. Ее значения можно менять без пересоздания оверлея через событие `dalnoboyshiki2:hud-update`:

```js
window.dispatchEvent(
  new CustomEvent("dalnoboyshiki2:hud-update", {
    detail: {
      time: "09:47",
      speedKmh: 87,
      gear: 4,
      rpm: 3150,
      fuelPercent: 12,
      engineWarning: true,
    },
  }),
);
```

`fuelPercent` принимает значения от 0 до 100, а `rpm` — реальные обороты двигателя. Панель сама преобразует обороты в формат `x100` и включает предупреждение при остатке топлива 15% или меньше.

## Шрифт

Для подписей HUD используется локальная копия [Press Start 2P](https://github.com/google/fonts/tree/main/ofl/pressstart2p). Шрифт распространяется по лицензии SIL Open Font License 1.1; текст лицензии находится в `fonts/OFL-PressStart2P.txt`.
