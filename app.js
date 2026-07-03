/**
 * GIDEON-Stream-Client // Сетевой координатор P2P-видеосвязи WebRTC
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

// Константы и состояние сессии
const DENSITY = 400; // Количество вокселей в полувитке Сфирали
let peer = null;
let dataConnection = null;
let sTime = 0;
let lastReceivedData = null; // Буфер принятого сжатого потока

// Подгонка размеров окон вывода
function resizeViewports() {
    localCanvas.width = localCanvas.clientWidth;
    localCanvas.height = localCanvas.clientHeight;
    remoteCanvas.width = remoteCanvas.clientWidth;
    remoteCanvas.height = remoteCanvas.clientHeight;
}
window.addEventListener('resize', resizeViewports);
resizeViewports();

// --- 1. СЕТЕВАЯ ИНИЦИАЛИЗАЦИЯ (PeerJS / WebRTC) ---

// Подключаемся к глобальной сигнальной сети PeerJS
peer = new Peer({
    host: '://peerjs.com',
    port: 443,
    secure: true,
    debug: 1
});

// Успешный запуск узла в сети
peer.on('open', (id) => {
    myIdDisplay.innerText = id;
    netStatus.innerText = "СТАТУС: В СЕТИ, ОЖИДАНИЕ СЕССИИ";
    netStatus.style.color = "#00ffcc";
    startCameraCapture(); // Автоматически запускаем сенсор камеры
});

// Обработка входящего звонка (Собеседник подключается к нам)
peer.on('connection', (conn) => {
    dataConnection = conn;
    setupConnectionHandlers();
    setNetworkActiveStatus();
});

// Логика нажатия кнопки "Вызов"
btnConnect.addEventListener('click', () => {
    const remoteId = peerIdInput.value.trim();
    if (!remoteId) {
        alert("Пожалуйста, введите корректный ID собеседника.");
        return;
    }
    netStatus.innerText = "СТАТУС: УСТАНОВКА СОЕДИНЕНИЯ...";
    // Инициируем прямое P2P соединение
    dataConnection = peer.connect(remoteId);
    setupConnectionHandlers();
});

function setupConnectionHandlers() {
    dataConnection.on('open', () => {
        setNetworkActiveStatus();
    });

    // ПРИЕМ СЖАТОГО ПОТОКА: Браузер принимает по сети только 50% данных
    dataConnection.on('data', (data) => {
        if (data && data.type === 'sfiral_stream') {
            lastReceivedData = data.voxels; // Складываем левые воксели в буфер
        }
    });

    dataConnection.on('close', () => {
        netStatus.innerText = "СТАТУС: СЕССИЯ ЗАВЕРШЕНА";
        netStatus.style.color = "#ff4444";
        dataConnection = null;
    });
}

function setNetworkActiveStatus() {
    netStatus.innerText = `СТАТУС: P2P СЕССИЯ АКТИВНА [УЗЕЛ: ${dataConnection.peer.substring(0,8)}...]`;
    netStatus.style.color = "#bd00ff";
}

// --- 2. ЗАХВАТ И ОЦИФРОВКА СЕНСОРА КАМЕРЫ ---

async function startCameraCapture() {
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: { width: 80, height: 60 } });
        localVideo.srcObject = stream;
        localVideo.play();
    } catch (err) {
        netStatus.innerText = "ОШИБКА: НЕТ ДОСТУПА К СЕНСОРУ КАМЕРЫ";
        netStatus.style.color = "#ff4444";
    }
}

// --- 3. ГЛАВНЫЙ ВЫЧИСЛИТЕЛЬНЫЙ И ТРАНСЛЯЦИОННЫЙ КОНВЕЙЕР ---

function runStreamingPipeline() {
    // Очищаем оба экрана проектора перед рендером нового кадра
    glLocal.clearRect(0, 0, localCanvas.width, localCanvas.height);
    glRemote.clearRect(0, 0, remoteCanvas.width, remoteCanvas.height);

    sTime += 0.006; // Постоянное фазовое авто-вращение Сфирали

    const cxL = localCanvas.width / 2;
    const cyL = localCanvas.height / 2;
    const cxR = remoteCanvas.width / 2;
    const cyR = remoteCanvas.height / 2;

    const scaleL = Math.min(localCanvas.width, localCanvas.height) / 4;
    const scaleR = Math.min(remoteCanvas.width, remoteCanvas.height) / 4;

    // Извлекаем пиксели из камеры во внутренний буфер
    let pixelData = null;
    if (localVideo.readyState >= 2) {
        hCtx.clearRect(0, 0, 80, 60);
        hCtx.drawImage(localVideo, 0, 0, 80, 60);
        pixelData = hCtx.getImageData(0, 0, 80, 60).data;
    }

    let outgoingVoxelsPack = []; // Массив для сжатого сетевого пакета

    // --- БЛОК А: ИСХОДЯЩИЙ ПОТОК (ОТПРАВИТЕЛЬ) ---
    // Мы генерируем воксели СТРОГО для левого полувитка (t от -1.0 до 0.0)
    for (let i = 0; i < DENSITY; i++) {
        let t = (i / (DENSITY - 1)) - 1.0; // t бежит строго от -1.0 до 0.0

        // Извлекаем левую 3D точку из оригинального сфирального ядра кодека
        const leftVoxel = SfiralP2P.getLeftStreamVoxel(t, sTime);

        // Проекция 3D -> 2D экрана
        const screenX = cxL + leftVoxel.x * scaleL;
        const screenY = cyL + leftVoxel.y * scaleL - (t * 40); // Высотный сдвиг

        let r = 31, g = 119, b = 180, a = 0.85; // Канонический синий цвет V- по умолчанию

        if (pixelData) {
            // Ортогональный маппинг 3D вокселя на 2D пиксели камеры (80x60)
            let u = Math.floor(((SfiralP2P.R_coil - leftVoxel.x) / (SfiralP2P.R_coil * 2)) * 80);
            let v = Math.floor(((leftVoxel.y + SfiralP2P.R_coil) / (SfiralP2P.R_coil * 2)) * 60);
            u = Math.max(0, Math.min(79, u)); v = Math.max(0, Math.min(59, v));

            const idx = (v * 80 + u) * 4;
            r = pixelData[idx]; g = pixelData[idx + 1]; b = pixelData[idx + 2];
            a = (r + g + b) / 3 / 255;
        }

        // Если воксель активен, отрисовываем его в левом окне "Трансляция"
        if (a > 0.08) {
            glLocal.beginPath();
            glLocal.arc(screenX, screenY, 3.5, 0, 2 * Math.PI);
            glLocal.fillStyle = `rgba(${r}, ${g}, ${b}, ${a})`;
            glLocal.fill();

            // Упаковываем воксель в сетевой пакет для передачи через WebRTC
            // Передаем только координаты левой точки и ее цвет. Правая не нужна!
            outgoingVoxelsPack.push({
                x: leftVoxel.x, y: leftVoxel.y, z: t, r, g, b, a
            });
        }
    }

    // ТРАНСЛЯЦИЯ В СЕТЬ (ОТПРАВКА 50% ДАННЫХ)
    // Отправляем пакет собеседнику, если WebRTC сессия активна
    if (dataConnection && dataConnection.open && outgoingVoxelsPack.length > 0) {
        dataConnection.send({
            type: 'sfiral_stream',
            voxels: outgoingVoxelsPack
        });
    }

    // --- БЛОК Б: ВХОДЯЩИЙ ПОТОК (ПРИЕМНИК) ---
    // Если мы получили сжатый сетевой пакет от собеседника, запускаем регенерацию
    if (lastReceivedData && lastReceivedData.length > 0) {
        lastReceivedData.forEach(voxel => {
            // 1. Отрисовываем принятую левую половину (V-)
            const scrLeftX = cxR + voxel.x * scaleR;
            const scrLeftY = cyR + voxel.y * scaleR - (voxel.z * 40);

            glRemote.beginPath();
            glRemote.arc(scrLeftX, scrLeftY, 3.5, 0, 2 * Math.PI);
            glRemote.fillStyle = `rgba(${voxel.r}, ${voxel.g}, ${voxel.b}, ${voxel.a})`;
            glRemote.fill();

            // 2. РЕГЕНЕРАЦИЯ: Восстанавливаем правую половину (V+) на лету по закону антисимметрии
            // Мы не скачивали эти точки из сети! Мы сгенерировали их прямо в браузере клиента.
            const rightVoxel = SfiralP2P.reconstructRightVoxel({ x: voxel.x, y: voxel.y, zOffset: voxel.z });

            const scrRightX = cxR + rightVoxel.x * scaleR;
            const scrRightY = cyR + rightVoxel.y * scaleR - ((-voxel.z) * 40); // Инверсия высотного знака

            glRemote.beginPath();
            glRemote.arc(scrRightX, scrRightY, 3.5, 0, 2 * Math.PI);
            // Окрашиваем регенерированный виток в канонический красный цвет автора для наглядности
            glRemote.fillStyle = `rgba(214, 39, 40, ${voxel.a})`; 
            glRemote.fill();
        });
    }

    // Непрерывный конвейер потоковой декомпозиции
    requestAnimationFrame(runStreamingPipeline);
}

// Запуск стриминг-конвейера
runStreamingPipeline();
