/**
 * GIDEON-Stream-Client // Сетевой координатор P2P-видеосвязи (Тестовый режим)
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

const DENSITY = 400; // Количество вокселей в полувитке Сфирали
let sTime = 0;

// Устанавливаем понятные статусы для новичка
myIdDisplay.innerText = "GIDEON_LOCAL_NODE";
netStatus.innerText = "СТАТУС: РЕЖИМ САМОДИАГНОСТИКИ (АВТОНОМНО)";
netStatus.style.color = "#00ffcc";

// Автоматически запускаем сенсор камеры
startCameraCapture();

// Подгонка размеров окон вывода
function resizeViewports() {
    localCanvas.width = localCanvas.clientWidth;
    localCanvas.height = localCanvas.clientHeight;
    remoteCanvas.width = remoteCanvas.clientWidth;
    remoteCanvas.height = remoteCanvas.clientHeight;
}
window.addEventListener('resize', resizeViewports);
resizeViewports();

// --- ЗАХВАТ И ОЦИФРОВКА СЕНСОРА КАМЕРЫ ---
async function startCameraCapture() {
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: { width: 80, height: 60 } });
        localVideo.srcObject = stream;
        localVideo.play();
    } catch (err) {
        netStatus.innerText = "РЕЖИМ: МАТЕМАТИЧЕСКИЙ ТЕСТ (БЕЗ КАМЕРЫ)";
    }
}

// --- ГЛАВНЫЙ ВЫЧИСЛИТЕЛЬНЫЙ КОНВЕЙЕР ---
function runStreamingPipeline() {
    // Очищаем оба экрана проектора перед рендером нового кадра
    glLocal.clearRect(0, 0, localCanvas.width, localCanvas.height);
    glRemote.clearRect(0, 0, remoteCanvas.width, remoteCanvas.height);

    sTime += 0.006; // Постоянное фазовое авто-вращение Сфирали

    const cxL = localCanvas.width / 2; const cyL = localCanvas.height / 2;
    const cxR = remoteCanvas.width / 2; const cyR = remoteCanvas.height / 2;

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

    // --- БЛОК А: ИСХОДЯЩИЙ ПОТОК ---
    // Мы генерируем воксели СТРОГО для левого полувитка (t от -1.0 до 0.0)
    for (let i = 0; i < DENSITY; i++) {
        let t = (i / (DENSITY - 1)) - 1.0; // t бежит строго от -1.0 до 0.0

        // Извлекаем левую 3D точку из оригинального сфирального ядра кодека
        const leftVoxel = SfiralP2P.getLeftStreamVoxel(t, sTime);

        // Проекция 3D -> 2D экрана
        const screenX = cxL + leftVoxel.x * scaleL;
        const screenY = cyL + leftVoxel.y * scaleL - (t * 40); // Высотный сдвиг

        let r = 31, g = 119, b = 180, a = 0.85; // Синий цвет V- по умолчанию

        if (pixelData) {
            let u = Math.floor(((SfiralP2P.R_coil - leftVoxel.x) / (SfiralP2P.R_coil * 2)) * 80);
            let v = Math.floor(((leftVoxel.y + SfiralP2P.R_coil) / (SfiralP2P.R_coil * 2)) * 60);
            u = Math.max(0, Math.min(79, u)); v = Math.max(0, Math.min(59, v));

            const idx = (v * 80 + u) * 4;
            r = pixelData[idx]; g = pixelData[idx + 1]; b = pixelData[idx + 2];
            a = (r + g + b) / 3 / 255;
        }

        // Отрисовываем левый виток в окне "Трансляция"
        if (a > 0.08) {
            glLocal.beginPath();
            glLocal.arc(screenX, screenY, 3.5, 0, 2 * Math.PI);
            glLocal.fillStyle = `rgba(${r}, ${g}, ${b}, ${a})`;
            glLocal.fill();

            // Сохраняем левую точку в виртуальный сетевой пакет
            outgoingVoxelsPack.push({ x: leftVoxel.x, y: leftVoxel.y, z: t, r, g, b, a });
        }
    }

    // ИНЖЕНЕРНЫЙ МОД: Замыкаем поток на себя, чтобы протестировать 50% регенерацию без интернета
    let lastReceivedData = outgoingVoxelsPack;

    // --- БЛОК Б: ВХОДЯЩИЙ ПОТОК И РЕГЕНЕРАЦИЯ ---
    if (lastReceivedData && lastReceivedData.length > 0) {
        lastReceivedData.forEach(voxel => {
            // 1. Отрисовываем "принятую" левую половину (V-)
            const scrLeftX = cxR + voxel.x * scaleR;
            const scrLeftY = cyR + voxel.y * scaleR - (voxel.z * 40);

            glRemote.beginPath();
            glRemote.arc(scrLeftX, scrLeftY, 3.5, 0, 2 * Math.PI);
            glRemote.fillStyle = `rgba(${voxel.r}, ${voxel.g}, ${voxel.b}, ${voxel.a})`;
            glRemote.fill();

            // 2. ПОДЛИННАЯ РЕГЕНЕРАЦИЯ: Восстанавливаем правую половину (V+) на лету по закону антисимметрии
            // Мы берем параметры левой точки и зеркально отзеркаливаем её
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
