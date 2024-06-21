function createOverlay() {
    // Создаем контейнер для оверлея
    let overlay = document.createElement('div');
    overlay.id = 'truck-overlay';
  
    // Создаем верхнюю часть кабины
    let topCabin = document.createElement('img');
    topCabin.src = chrome.runtime.getURL('images/top-cabin.png');
    topCabin.id = 'top-cabin';
  
    // Создаем нижнюю часть кабины
    let bottomCabin = document.createElement('img');
    bottomCabin.src = chrome.runtime.getURL('images/bottom-cabin.png');
    bottomCabin.id = 'bottom-cabin';
  
    // Добавляем элементы на страницу
    overlay.appendChild(topCabin);
    overlay.appendChild(bottomCabin);
    document.body.appendChild(overlay);
  }
  
  // Проверяем, находится ли пользователь в режиме Street View
  function checkStreetView() {
    let url = window.location.href;
    if (url.includes('@') && url.includes('!1s')) {
      // Пользователь в режиме Street View
      createOverlay();
    }
  }
  
  // Запускаем проверку при загрузке страницы
  window.addEventListener('load', checkStreetView);
  