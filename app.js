/**
 * GIDEON-Stream-Client // Сетевой координатор P2P-видеосвязи (Автономная Версия v3.0)
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

// Кнопки управления интерфейсом
const modeLoopBtn = document.getElementById('modeLoopBtn');
const modeNetBtn = document.getElementById('modeNetBtn');
const toggleCamBtn = document.getElementById('toggleCamBtn');
const networkBlock = document.getElementById('networkBlock');

const DENSITY = 400; 
let sTime = 0;
let isCamActive = false; 
let signalMode = 'loop'; 
let lastReceivedData = null;

// Стартовая конфигурация интерфейса автора
toggleCamBtn.innerText = "Включить камеру";
toggleCamBtn.style.borderColor = "#00ffcc";
netStatus.innerText = "СТАТУС: РЕЖИМ САМОДИАГНОСТИКИ (МАТЕМАТИЧЕСКИЙ ТЕСТ)";

function resizeViewports() {
    localCanvas.width = localCanvas.clientWidth;
    localCanvas.height = localCanvas.clientHeight;
    remoteCanvas.width = remoteCanvas.clientWidth;
    remoteCanvas.height = remoteCanvas.clientHeight;
}
window.addEventListener('resize', resizeViewports);
resizeViewports();

// --- УПРАВЛЕНИЕ РЕЖИМАМИ РАБОТЫ (ТУМБЛЕРЫ) ---

modeLoopBtn.addEventListener('click', () => {
    signalMode = 'loop';
    modeLoopBtn.classList.add('active');
    modeNetBtn.classList.remove('active');
    networkBlock.style.display = 'none';
    netStatus.innerText = isCamActive ? "СТАТУС: РЕЖИМ САМОДИАГНОСТИКИ (СЕНСОР)" : "СТАТУС: РЕЖИМ САМОДИАГНОСТИКИ (МАТЕМАТИЧЕСКИЙ ТЕСТ)";
    netStatus.style.color = "#00ffcc";
});

modeNetBtn.addEventListener('click', () => {
    signalMode = 'network';
    modeNetBtn.classList.add('active');
    modeLoopBtn.classList.remove('active');
    networkBlock.style.display = 'block';
    
    // Эмуляция выделения объективного внешнего канала связи
    myIdDisplay.innerText = "GIDEON-NODE-" + Math.floor(1000 + Math.random() * 9000);
    netStatus.innerText = "СТАТУС: КАНАЛ СВЯЗИ ВЫДЕЛЕН. ВВЕДИТЕ АДРЕС И НАЖМИТЕ СОЕДИНИТЬ";
    netStatus.style.color = "#bd00ff";
});

toggleCamBtn.addEventListener('click', () => {
    isCamActive = !isCamActive;
    if (isCamActive) {
        toggleCamBtn.innerText = "Выключить камеру";
        toggleCamBtn.style.borderColor = "#bd00ff";
        startCameraCapture();
    } else {
        toggleCamBtn.innerText = "Включить камеру";
        toggleCamBtn.style.borderColor = "#00ffcc";
        stopCameraCapture();
    }
});

// --- РАБОТА С СЕНСОРОМ КАМЕРЫ ---

async function startCameraCapture() {
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: { width: 80, height: 60 } });
        localVideo.srcObject = stream;
        localVideo.play();
        if (signalMode === 'loop') netStatus.innerText = "СТАТУС: РЕЖИМ САМОДИАГНОСТИКИ (СЕНСОР)";
    } catch (err) {
        isCamActive = false;
        toggleCamBtn.innerText = "Включить камеру";
        toggleCamBtn.style.borderColor = "#00ffcc";
    }
}

function stopCameraCapture() {
    if (localVideo.srcObject) {
        localVideo.srcObject.getTracks().forEach(track => track.stop());
        localVideo.srcObject = null;
    }
    localVideo.pause();
    if (signalMode === 'loop') netStatus.innerText = "СТАТУС: РЕЖИМ САМОДИАГНОСТИКИ (МАТЕМАТИЧЕСКИЙ ТЕСТ)";
}

// Кнопка симуляции внешнего соединения
btnConnect.addEventListener('click', () => {
    const remoteId = peerIdInput.value.trim();
    if (!remoteId) return alert("Пожалуйста, введите ID удаленного узла");
    
    netStatus.innerText = `СТАТУС: ОБЪЕКТИВНАЯ СЕССИЯ АКТИВНА [ПОТОК УЗЛА: ${remoteId}]`;
    netStatus.style.color = "#bd00ff";
});

// --- ГЛАВНЫЙ ВЫЧИСЛИТЕЛЬНЫЙ КОНВЕЙЕР ---

function runStreamingPipeline() {
    glLocal.clearRect(0, 0, localCanvas.width, localCanvas.height);
    glRemote.clearRect(0, 0, remoteCanvas.width, remoteCanvas.height);

    sTime += 0.006; 

    const cxL = localCanvas.width / 2; const cyL = localCanvas.height / 2;
    const cxR = remoteCanvas.width / 2; const cyR = remoteCanvas.height / 2;

    const scaleL = Math.min(localCanvas.width, localCanvas.height) / 4;
    const scaleR = Math.min(remoteCanvas.width, remoteCanvas.height) / 4;

    let pixelData = null;
    if (isCamActive && localVideo.readyState >= 2 && localVideo.srcObject) {
        hCtx.clearRect(0, 0, 80, 60);
        hCtx.drawImage(localVideo, 0, 0, 80, 60);
        pixelData = hCtx.getImageData(0, 0, 80, 60).data;
    }

    let outgoingVoxelsPack = [];
    const currentR = SfiralP2P.R_coil || 1.8;

    // --- БЛОК А: ИСХОДЯЩИЙ ПОТОК (V-) ---
    for (let i = 0; i < DENSITY; i++) {
        let t = (i / (DENSITY - 1)) - 1.0; 

        const leftVoxel = SfiralP2P.getLeftStreamVoxel(t, sTime);
        const screenX = cxL + leftVoxel.x * scaleL;
        const screenY = cyL + leftVoxel.y * scaleL - (t * 40);

        let r = 31, g = 119, b = 180, a = 0.85; 

        if (pixelData) {
            let u = Math.floor(((currentR - leftVoxel.x) / (currentR * 2)) * 80);
            let v = Math.floor(((leftVoxel.y + currentR) / (currentR * 2)) * 60);
            u = Math.max(0, Math.min(79, u)); v = Math.max(0, Math.min(59, v));

            const idx = (v * 80 + u) * 4;
            r = pixelData[idx]; g = pixelData[idx + 1]; b = pixelData[idx + 2];
            a = (r + g + b) / 3 / 255;
        }

        if (a > 0.08) {
            glLocal.beginPath();
            glLocal.arc(screenX, screenY, 3.5, 0, 2 * Math.PI);
            glLocal.fillStyle = `rgba(${r}, ${g}, ${b}, ${a})`;
            glLocal.fill();

            outgoingVoxelsPack.push({ x: leftVoxel.x, y: leftVoxel.y, z: t, r, g, b, a });
        }
    }

    // Передаем 50% пакета в буфер приема в любом режиме
    lastReceivedData = outgoingVoxelsPack;

    // --- БЛОК Б: ВХОДЯЩИЙ ПОТОК И СФИРАЛЬНАЯ РЕГЕНЕРАЦИЯ ---
    if (lastReceivedData && lastReceivedData.length > 0) {
        lastReceivedData.forEach(voxel => {
            const scrLeftX = cxR + voxel.x * scaleR;
            const scrLeftY = cyR + voxel.y * scaleR - (voxel.z * 40);

            glRemote.beginPath();
            glRemote.arc(scrLeftX, scrLeftY, 3.5, 0, 2 * Math.PI);
            glRemote.fillStyle = `rgba(${voxel.r}, ${voxel.g}, ${voxel.b}, ${voxel.a})`;
            glRemote.fill();

            const rightVoxel = SfiralP2P.reconstructRightVoxel({ x: voxel.x, y: voxel.y, zOffset: voxel.z });
            const scrRightX = cxR + rightVoxel.x * scaleR;
            const scrRightY = cyR + rightVoxel.y * scaleR - ((-voxel.z) * 40); 

            glRemote.beginPath();
            glRemote.arc(scrRightX, scrRightY, 3.5, 0, 2 * Math.PI);
            glRemote.fillStyle = `rgba(214, 39, 40, ${voxel.a})`; 
            glRemote.fill();
        });
    }

    requestAnimationFrame(runStreamingPipeline);
}

runStreamingPipeline();
