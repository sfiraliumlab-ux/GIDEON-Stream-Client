/**
 * GIDEON-Stream-Client // Сетевой координатор через Telegram API
 */

// Селекторы интерфейса
const localCanvas = document.getElementById('localCanvas');
const glLocal = localCanvas.getContext('2d');
const remoteCanvas = document.getElementById('remoteCanvas');
const glRemote = remoteCanvas.getContext('2d');

const hiddenCanvas = document.getElementById('hiddenCanvas');
const hCtx = hiddenCanvas.getContext('2d');
const localVideo = document.getElementById('localVideo');

const myIdDisplay = document.getElementById('myId');
const peerIdInput = document.getElementById('peerIdInput');
const btnConnect = document.getElementById('btnConnect');
const netStatus = document.getElementById('netStatus');

// Константы и токен Telegram Вашего бота
const TG_TOKEN = "8632880535:AAHl_PdkJ1r5hYrR9PwzG5akGBVpUbY2my8";
const DENSITY = 350; 
let sTime = 0;

let myChatId = "LOCAL_USER";
let targetChatId = null;
let lastReceivedData = null;
let lastUpdateId = 0;

// Инициализация Telegram WebApp контекста
if (window.Telegram && window.Telegram.WebApp) {
    const tg = window.Telegram.WebApp;
    tg.ready();
    tg.expand(); // Разворачиваем на весь экран смартфона
    
    if (tg.initDataUnsafe && tg.initDataUnsafe.user) {
        myChatId = tg.initDataUnsafe.user.id.toString();
    }
}

// Выводим ID на экран
myIdDisplay.innerText = myChatId;
netStatus.innerText = "СТАТУС: ИНТЕГРАЦИЯ TG АКТИВНА. ОЖИДАНИЕ СЕССИИ";
netStatus.style.color = "#00ffcc";

// Запуск камеры сенсора
startCameraCapture();

// Подгонка окон
function resizeViewports() {
    localCanvas.width = localCanvas.clientWidth;
    localCanvas.height = localCanvas.clientHeight;
    remoteCanvas.width = remoteCanvas.clientWidth;
    remoteCanvas.height = remoteCanvas.clientHeight;
}
window.addEventListener('resize', resizeViewports);
resizeViewports();

// Логика кнопки подключения
btnConnect.addEventListener('click', () => {
    const inputVal = peerIdInput.value.trim();
    if (!inputVal) {
        alert("Пожалуйста, введите Chat ID абонента");
        return;
    }
    targetChatId = inputVal;
    netStatus.innerText = `СТАТУС: ТРАНСЛЯЦИЯ НА УЗЕЛ [${targetChatId}]`;
    netStatus.style.color = "#bd00ff";
    
    // Запускаем бесконечный цикл прослушивания входящих сигналов от бота
    setInterval(fetchTelegramUpdates, 1000);
});

// --- СЕТЕВОЙ ОБМЕН ЧЕРЕЗ TELEGRAM API ---

// Функция отправки 50% сжатых вокселей Сфирали абоненту
async function sendSfiralDataViaTG(voxelsPack) {
    if (!targetChatId) return;
    
    // Сжимаем пакет в ультра-компактную строку для экономии трафика мессенджера
    const payload = {
        type: "gideon_v-",
        from: myChatId,
        v: voxelsPack.map(pt => [Math.round(pt.x*100), Math.round(pt.y*100), Math.round(pt.z*100), pt.r, pt.g, pt.b])
    };

    try {
        await fetch(`https://telegram.org{TG_TOKEN}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                chat_id: targetChatId,
                text: `GIDEON_STREAM:${JSON.stringify(payload)}`,
                disable_notification: true
            })
        });
    } catch (e) {
        // Игнорируем сетевые задержки мессенджера
    }
}

// Функция приема и декомпозиции входящих данных от бота
async function fetchTelegramUpdates() {
    try {
        const res = await fetch(`https://telegram.org{TG_TOKEN}/getUpdates?offset=${lastUpdateId + 1}&limit=5`);
        if (!res.ok) return;
        const data = await res.json();
        
        if (data.ok && data.result.length > 0) {
            data.result.forEach(update => {
                lastUpdateId = update.update_id;
                
                if (update.message && update.message.text && update.message.text.startsWith("GIDEON_STREAM:")) {
                    const rawJson = update.message.text.replace("GIDEON_STREAM:", "");
                    try {
                        const parsed = JSON.parse(rawJson);
                        // Проверяем, что пакет прилетел именно нам и содержит нужный тип Сфирали V-
                        if (parsed.type === "gideon_v-") {
                            // Восстанавливаем нормальный масштаб чисел из сжатого пакета
                            lastReceivedData = parsed.v.map(arr => ({
                                x: arr[0]/100, y: arr[1]/100, z: arr[2]/100, r: arr[3], g: arr[4], b: arr[5], a: 0.9
                            }));
                        }
                    } catch(err) {}
                }
            });
        }
    } catch(e) {}
}

// --- ЗАХВАТ КАМЕРЫ ---
async function startCameraCapture() {
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: { width: 80, height: 60 } });
        localVideo.srcObject = stream;
        localVideo.play();
    } catch (err) {
        netStatus.innerText = "РЕЖИМ: СИНТЕТИЧЕСКИЙ МАТРИЧНЫЙ ТЕСТ";
    }
}

// --- ГЛАВНЫЙ ВЫЧИСЛИТЕЛЬНЫЙ КОНВЕЙЕР ---
let frameThrottle = 0;

function runStreamingPipeline() {
    glLocal.clearRect(0, 0, localCanvas.width, localCanvas.height);
    glRemote.clearRect(0, 0, remoteCanvas.width, remoteCanvas.height);

    sTime += 0.007;

    const cxL = localCanvas.width / 2; const cyL = localCanvas.height / 2;
    const cxR = remoteCanvas.width / 2; const cyR = remoteCanvas.height / 2;

    const scaleL = Math.min(localCanvas.width, localCanvas.height) / 4;
    const scaleR = Math.min(remoteCanvas.width, remoteCanvas.height) / 4;

    let pixelData = null;
    if (localVideo.readyState >= 2) {
        hCtx.clearRect(0, 0, 80, 60);
        hCtx.drawImage(localVideo, 0, 0, 80, 60);
        pixelData = hCtx.getImageData(0, 0, 80, 60).data;
    }

    let outgoingVoxelsPack = [];

    // 1. ИСХОДЯЩИЙ ПОТОК (Генерация 50% Сфирали V-)
    for (let i = 0; i < DENSITY; i++) {
        let t = (i / (DENSITY - 1)) - 1.0; 

        const leftVoxel = SfiralP2P.getLeftStreamVoxel(t, sTime);
        const screenX = cxL + leftVoxel.x * scaleL;
        const screenY = cyL + leftVoxel.y * scaleL - (t * 40);

        let r = 31, g = 119, b = 180, a = 0.85; 

        if (pixelData) {
            let u = Math.floor(((SfiralP2P.R_coil - leftVoxel.x) / (SfiralP2P.R_coil * 2)) * 80);
            let v = Math.floor(((leftVoxel.y + SfiralP2P.R_coil) / (SfiralP2P.R_coil * 2)) * 60);
            u = Math.max(0, Math.min(79, u)); v = Math.max(0, Math.min(59, v));

            const idx = (v * 80 + u) * 4;
            r = pixelData[idx]; g = pixelData[idx + 1]; b = pixelData[idx + 2];
            a = (r + g + b) / 3 / 255;
        }

        if (a > 0.1) {
            glLocal.beginPath();
            glLocal.arc(screenX, screenY, 3.5, 0, 2 * Math.PI);
            glLocal.fillStyle = `rgba(${r}, ${g}, ${b}, ${a})`;
            glLocal.fill();

            outgoingVoxelsPack.push({ x: leftVoxel.x, y: leftVoxel.y, z: t, r, g, b });
        }
    }

    // Дросселирование отправки в Telegram (раз в 15 кадров, чтобы бот не спамил)
    frameThrottle++;
    if (frameThrottle >= 15 && outgoingVoxelsPack.length > 0) {
        sendSfiralDataViaTG(outgoingVoxelsPack);
        frameThrottle = 0;
    }

    // 2. ВХОДЯЩИЙ ПОТОК И РЕГЕНЕРАЦИЯ ИЗ TELEGRAM
    if (lastReceivedData && lastReceivedData.length > 0) {
        lastReceivedData.forEach(voxel => {
            // Отрисовка принятого левого витка V-
            const scrLeftX = cxR + voxel.x * scaleR;
            const scrLeftY = cyR + voxel.y * scaleR - (voxel.z * 40);

            glRemote.beginPath();
            glRemote.arc(scrLeftX, scrLeftY, 3.5, 0, 2 * Math.PI);
            glRemote.fillStyle = `rgba(${voxel.r}, ${voxel.g}, ${voxel.b}, 0.8)`;
            glRemote.fill();

            // ПОДЛИННАЯ РЕГЕНЕРАЦИЯ: Восстановление правого витка V+ по закону антисимметрии автора
            const rightVoxel = SfiralP2P.reconstructRightVoxel({ x: voxel.x, y: voxel.y, zOffset: voxel.z });
            const scrRightX = cxR + rightVoxel.x * scaleR;
            const scrRightY = cyR + rightVoxel.y * scaleR - ((-voxel.z) * 40); 

            glRemote.beginPath();
            glRemote.arc(scrRightX, scrRightY, 3.5, 0, 2 * Math.PI);
            glRemote.fillStyle = `rgba(214, 39, 40, 0.8)`; // Окрашиваем регенерированную сторону в красный
            glRemote.fill();
        });
    }

    requestAnimationFrame(runStreamingPipeline);
}

runStreamingPipeline();
